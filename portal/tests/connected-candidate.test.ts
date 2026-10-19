import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createPairingConsent, f1PairingConsent, normalPairingConsent,
  type PairingConsentPolicy } from "../src/browser-pairing";
import { connectedCandidateOrigin as origin, connectedCandidateConsent as consent,
  connectedClerkFrontend, requireConnectedCandidateBrowser, connectedCandidateReturnUrl,
  connectedCandidateNavigation, isConnectedCandidateBrowserRequest, connectedCandidateBrowserApi } from "../src/candidate/connected-policy";
import { initialNavigation } from "../src/app/unified/model";
import { connectedCandidateOrigin as serverOrigin } from "../../netlify/functions/_shared/connected-candidate";

const state = "a".repeat(43), challenge = "b".repeat(43), code = `pair_${"c".repeat(43)}`;
const hash = `#state=${state}&code_challenge=${challenge}&scope=sync%3Awrite&scope=self%3Arevoke&scope=content%3Aread`;
const time = 1800000000000;
const callback = (protocol = "omgskills") => `${protocol}://pair?code=${code}&state=${state}`;
const approved = (protocol = "omgskills") => ({ callbackUrl: callback(protocol), expiresAt: new Date(time + 60000).toISOString() });
const metadataBody = { state, codeChallenge: challenge, codeChallengeMethod: "S256", scopes: ["sync:write", "self:revoke"] };
const config = { profile: "connected", publishableKey: `pk_test_${Buffer.from("cc2b-fixture.clerk.accounts.dev$").toString("base64")}`,
  clerkFrontendOrigin: "https://cc2b-fixture.clerk.accounts.dev" };
function fixture(policy: PairingConsentPolicy = consent, response: () => Promise<unknown> = async () => approved(), fragment = hash) {
  const calls: { path: string; init?: RequestInit }[] = [], opens: string[] = [];
  const changes: string[] = [];
  const session = createPairingConsent(fragment, policy, {
    api: async <T>(path: string, init?: RequestInit) => { calls.push({ path, init }); return await response() as T; },
    navigate: url => { opens.push(url); }, changed: snapshot => { changes.push(snapshot.phase); }, now: () => time,
  });
  return { session, calls, opens, changes };
}

test("candidate profile and development frontend must be explicit and match the test key", () => {
  assert.equal(origin, serverOrigin);
  assert.equal(connectedClerkFrontend(config.publishableKey), config.clerkFrontendOrigin);
  assert.deepEqual(requireConnectedCandidateBrowser(config, origin + "/app/"), {
    publishableKey: config.publishableKey, clerkFrontendOrigin: config.clerkFrontendOrigin,
    returnUrl: origin + "/app/", route: "app",
  });
  for (const profile of [undefined, "", "1", "install-only", "production"]) {
    assert.throws(() => requireConnectedCandidateBrowser({ ...config, profile }, origin + "/app/"));
  }
  for (const key of [undefined, "pk_test_fixture", "pk_live_ignored", "sk_test_ignored",
    `pk_test_${Buffer.from("other.example.test$").toString("base64")}`,
    `pk_test_${Buffer.from("cc2b-fixture.clerk.accounts.dev.evil.test$").toString("base64")}`]) {
    assert.throws(() => requireConnectedCandidateBrowser({ ...config, publishableKey: key }, origin + "/app/"));
  }
  for (const frontend of [undefined, config.clerkFrontendOrigin + "/", "https://another.clerk.accounts.dev", "https://omgskills.com"]) {
    assert.throws(() => requireConnectedCandidateBrowser({ ...config, clerkFrontendOrigin: frontend }, origin + "/app/"));
  }
});

test("return paths preserve valid pending fragments and catalog routes without accepting external redirects", () => {
  for (const path of ["/app/", "/app/?view=discover&q=design&skill=catalog%3Aa%2Fb", "/app/connect" + hash]) {
    const url = origin + path;
    assert.equal(connectedCandidateReturnUrl(url), url);
    assert.equal(requireConnectedCandidateBrowser(config, url).returnUrl, url);
  }
  assert.equal(requireConnectedCandidateBrowser(config, origin + "/app/connect" + hash).route, "connect");
  for (const url of ["https://omgskills.com/app/", "http://localhost:5201/app/", origin + ".evil.test/app/",
    "https://draft--omgskills-setup-test-f3b.netlify.app/app/", origin + "/app", origin + "/app/index.html",
    origin + "/app/connect", origin + "/app/connect/" + hash, origin + "/app/connect?return=https://evil.test" + hash,
    origin + "/app/?view=all&view=discover", origin + "/app/?redirect=https://evil.test", origin + "/app/#anything",
    origin.replace("https://", "https://user:password@") + "/app/", "/app/connect" + hash]) {
    assert.equal(connectedCandidateReturnUrl(url), null, url);
    assert.throws(() => requireConnectedCandidateBrowser(config, url));
  }
});

test("candidate parses native optional permission but rejects malformed and injected fragments", () => {
  assert.equal(consent.parse(hash)?.scopes.includes("content:read"), true);
  assert.deepEqual(consent.scopes(consent.parse(hash)!), ["sync:write", "self:revoke"]);
  for (const bad of ["", "#state=bad&code_challenge=bad", hash + `&state=${state}`, hash + `&code_challenge=${challenge}`,
    hash + "&scope=sync%3Awrite", hash + "&scope=admin", hash + "&callbackUrl=https://evil.test", hash + "&code=arbitrary",
    `#state=${state}&code_challenge=${challenge}&scope=content%3Aread`]) {
    assert.equal(consent.parse(bad), null, bad);
    assert.equal(connectedCandidateReturnUrl(origin + "/app/connect" + bad), null);
  }
});

test("candidate navigation keeps supported account views and clears unsupported private routes", () => {
  for (const view of ["all", "agents", "devices", "profile"] as const) {
    const nav = { ...initialNavigation, view };
    assert.equal(connectedCandidateNavigation(nav, true).view, view);
    assert.equal(connectedCandidateNavigation(nav, false).view, "discover");
  }
  for (const view of ["github", "mcp", "set", "sets", "favorites"] as const) {
    const nav = connectedCandidateNavigation({ ...initialNavigation, view, id: "private-set", query: "private query", selected: "set-item:private" }, true);
    assert.deepEqual(nav, { ...initialNavigation, view: "discover" });
  }
  const nav = connectedCandidateNavigation({ ...initialNavigation, view: "discover", query: "design", selected: "catalog:a/b", source: "private" }, false);
  assert.equal(nav.query, "design"); assert.equal(nav.selected, "catalog:a/b"); assert.equal(nav.source, "all");
});

test("browser transport allows only metadata approval and exact account reads, never native or management operations", async () => {
  let calls = 0;
  const transport = connectedCandidateBrowserApi(async <T>(_path: string, init?: RequestInit) => {
    calls++; assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); return { ok: true } as T;
  });
  const paths = ["synced-skills?version=3", "devices", "profile", "groups", "shared", "groups/ee703c1d-f17a-456c-a9bd-02457f27b314"];
  for (const path of paths) await transport("/api/portal/" + path);
  const approval = { method: "POST", body: JSON.stringify(metadataBody) };
  await transport("/api/portal/sync-pairing-code", approval);
  assert.equal(calls, paths.length + 1);
  const before = calls;
  const denied: [string, RequestInit?][] = [
    ["/api/portal/synced-skills"], ["/api/portal/synced-skills?version=2"],
    ["/api/portal/synced-skills?version=3&userId=other"], ["/api/portal/groups?userId=other"],
    ["/api/portal/groups/not-a-uuid"], ["/api/portal/private-sources"], ["/api/portal/groups", { method: "POST", body: "{}" }],
    ["/api/portal/profile", { method: "PATCH", body: "{}" }], ["/api/portal/devices/mac", { method: "DELETE" }],
    ["/api/portal/sync-exchange", approval], ["/api/portal/sync-upload", approval], ["/api/portal/device-revoke", approval],
    ["/api/portal/profile", { body: "{}" }], ["https://omgskills.com/api/portal/profile"],
    ["/api/portal/sync-pairing-code", { method: "POST", body: "{" }],
  ];
  for (const body of [null, [], {}, { ...metadataBody, userId: "other" }, { ...metadataBody, state: "bad" },
    { ...metadataBody, scopes: [...metadataBody.scopes, "content:read"] }, { ...metadataBody, scopes: ["sync:write", "sync:write"] }]) {
    denied.push(["/api/portal/sync-pairing-code", { method: "POST", body: JSON.stringify(body) }]);
  }
  for (const [path, init] of denied) {
    assert.equal(isConnectedCandidateBrowserRequest(path, init), false, path);
    await assert.rejects(transport(path, init));
  }
  assert.equal(calls, before);
});

test("consent is inert until an explicit click and grants metadata only once", async () => {
  const f = fixture();
  assert.equal(f.session.getSnapshot().phase, "ready"); assert.deepEqual(f.calls, []); assert.deepEqual(f.opens, []);
  const pending = f.session.approve(); const duplicate = f.session.approve();
  await Promise.all([pending, duplicate]); await f.session.approve();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/api/portal/sync-pairing-code");
  assert.deepEqual(JSON.parse(f.calls[0].init!.body as string), metadataBody);
  assert.equal(f.calls[0].init?.method, "POST"); assert.equal(f.calls[0].init?.cache, "no-store");
  assert.equal(f.calls[0].init?.redirect, "error"); assert.deepEqual(f.opens, [callback()]);
  assert.equal(f.session.getSnapshot().phase, "returning");
  assert.doesNotMatch(f.session.getSnapshot().status, /connected/i);
  const reloaded = fixture(); assert.deepEqual(reloaded.calls, []); assert.deepEqual(reloaded.opens, []);
});

test("invalid consent cannot approve or cancel", async () => {
  const f = fixture(consent, undefined, "#bad");
  await f.session.approve(); f.session.cancel();
  assert.equal(f.session.getSnapshot().phase, "invalid"); assert.deepEqual(f.calls, []); assert.deepEqual(f.opens, []);
});

test("normal and F1 consent retain optional content scope, disclosure and their own callback targets", async () => {
  for (const [policy, protocol] of [[normalPairingConsent, "omgskills"], [f1PairingConsent, "omgskills-f1"]] as const) {
    const f = fixture(policy, async () => approved(protocol)); await f.session.approve();
    assert.deepEqual(JSON.parse(f.calls[0].init!.body as string).scopes, ["sync:write", "self:revoke", "content:read"]);
    assert.deepEqual(f.opens, [callback(protocol)]);
    const cancelled = fixture(policy); cancelled.session.cancel();
    assert.deepEqual(cancelled.calls, []);
    assert.equal(new URL(cancelled.opens[0]).protocol, protocol + ":");
  }
  assert.equal(normalPairingConsent.disclosure, undefined); assert.ok(f1PairingConsent.disclosure?.includes("outside OMGSkills"));
});

test("cancel aborts pending approval and late responses cannot hand off", async () => {
  let finish!: (value: unknown) => void;
  const f = fixture(consent, () => new Promise(resolve => { finish = resolve; }));
  const pending = f.session.approve(); f.session.cancel(); f.session.cancel();
  assert.ok(f.calls[0].init?.signal?.aborted);
  finish(approved()); await pending; await f.session.approve();
  assert.equal(f.opens.length, 1);
  assert.deepEqual(Object.fromEntries(new URL(f.opens[0]).searchParams), { error: "access_denied", state });
  assert.equal(f.session.getSnapshot().phase, "cancelled");
  const idle = fixture(); idle.session.cancel(); assert.deepEqual(idle.calls, []);
});

test("unmount/sign-out disposal suppresses late success and failure without touching a replacement page", async () => {
  for (const success of [true, false]) {
    let finish!: (value: unknown) => void, fail!: (reason: Error) => void;
    const old = fixture(consent, () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const pending = old.session.approve(); old.session.dispose();
    const changes = [...old.changes]; const replacement = fixture();
    if (success) finish(approved()); else fail(Error("Late failure"));
    await pending; await old.session.approve(); old.session.cancel();
    assert.ok(old.calls[0].init?.signal?.aborted); assert.deepEqual(old.opens, []); assert.deepEqual(old.changes, changes);
    assert.deepEqual(replacement.calls, []); assert.deepEqual(replacement.opens, []);
  }
});

test("expired or malformed responses do not open the app; retry still requires a click", async () => {
  for (const value of [null, {}, { ...approved(), expiresAt: "invalid" }, { ...approved(), expiresAt: new Date(time).toISOString() },
    { ...approved(), expiresAt: new Date(time - 1).toISOString() }]) {
    const f = fixture(consent, async () => value); await f.session.approve();
    assert.equal(f.session.getSnapshot().phase, "error"); assert.deepEqual(f.opens, []); assert.equal(f.calls.length, 1);
  }
  let count = 0;
  const f = fixture(consent, async () => { if (!count++) throw Error("Try again"); return approved(); });
  await f.session.approve(); assert.equal(f.calls.length, 1); assert.deepEqual(f.opens, []);
  await f.session.approve(); assert.equal(f.calls.length, 2); assert.deepEqual(f.opens, [callback()]);
});

test("candidate refuses mismatched and injected callbacks without weakening F1 validation", async () => {
  for (const callbackUrl of [callback("omgskills-f1"), "https://evil.test", callback().replace("pair?", "other?"),
    callback() + `&state=${state}`, callback() + "&redirect=https://evil.test", callback() + "#extra",
    callback().replace(state, "d".repeat(43)), callback().replace("pair_c", "device_c"),
    callback().replace("://pair", "://user:password@pair")]) {
    const f = fixture(consent, async () => ({ ...approved(), callbackUrl })); await f.session.approve();
    assert.equal(f.session.getSnapshot().phase, "error"); assert.deepEqual(f.opens, []);
  }
});

const consentComponent = (async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/ConnectPage.tsx", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, jsx: "automatic",
    plugins: [{ name: "no-live-account", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/portal-api$/ }, () => ({ path: "portal-api", namespace: "fake-account" }));
      plugin.onLoad({ filter: /.*/, namespace: "fake-account" }, () => ({
        contents: 'export function usePortalApi(){return function(){throw Error("Unexpected account request during rendering");}}', loader: "js",
      }));
    } }] });
  const module = { exports: {} as typeof import("../src/ConnectPage") };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
})();
function elements(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}

test("actual shared page renders with fake account context without approving or losing the pending fragment", async () => {
  const { ConnectPage } = await consentComponent;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { hash, assign() { assert.fail("Rendering must not open the app"); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  try {
    for (const policy of [consent, normalPairingConsent, f1PairingConsent]) {
      const html = renderToStaticMarkup(createElement(ConnectPage, { policy }));
      assert.match(html, /Connect this Mac\?/); assert.match(html, />Approve</);
      assert.equal(html.includes("Read private skills shared with you"), policy !== consent);
      assert.equal(location.hash, hash);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("rendered consent buttons run the real approval/cancellation actions with pending/finished guards", async () => {
  const { ConsentContent } = await consentComponent;
  let finish!: (value: unknown) => void;
  const f = fixture(consent, () => new Promise(resolve => { finish = resolve; }));
  const render = () => ConsentContent({ request: f.session.request, policy: consent, snapshot: f.session.getSnapshot(),
    approve: () => { void f.session.approve(); }, cancel: () => f.session.cancel() });
  const before = render();
  const html = renderToStaticMarkup(before);
  assert.match(html, /Connect this Mac\?/); assert.match(html, /outside OMGSkills/);
  assert.doesNotMatch(html, /Read private skills|content:read|href=|\.zip|\.dmg/);
  assert.deepEqual(f.calls, []);
  const buttons = elements(before).filter(element => typeof element.props.onClick === "function");
  (buttons[0].props.onClick as () => void)();
  assert.equal(f.calls.length, 1);
  assert.match(renderToStaticMarkup(render()), /disabled=""[^>]*>Approving/);
  (buttons[0].props.onClick as () => void)(); assert.equal(f.calls.length, 1);
  (buttons[1].props.onClick as () => void)(); finish(approved()); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.opens.length, 1); assert.match(f.opens[0], /error=access_denied/);
  assert.equal(f.session.getSnapshot().phase, "cancelled");
  assert.equal((renderToStaticMarkup(render()).match(/disabled=""/g) ?? []).length, 2);
});

test("shared rendered consent preserves normal/F1 permission text and disables malformed requests", async () => {
  const { ConsentContent } = await consentComponent;
  for (const policy of [normalPairingConsent, f1PairingConsent]) {
    const f = fixture(policy);
    const html = renderToStaticMarkup(createElement(ConsentContent, { request: f.session.request, policy,
      snapshot: f.session.getSnapshot(), approve() {}, cancel() {} }));
    assert.match(html, /Read private skills shared with you/);
    assert.equal(html.includes("outside OMGSkills"), policy === f1PairingConsent);
  }
  const f = fixture(consent, undefined, "#invalid");
  const html = renderToStaticMarkup(createElement(ConsentContent, { request: f.session.request, policy: consent,
    snapshot: f.session.getSnapshot(), approve() {}, cancel() {} }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2); assert.match(html, /role="alert"/);
});

test("B1 extracts only consent; candidate entry and session wiring remain absent", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../src/main.tsx"), /<ConnectPage policy=\{connectedInventoryTest \? f1PairingConsent : normalPairingConsent\}/);
  assert.doesNotMatch(source("../src/main.tsx"), /candidate\/connected-policy|function ConnectPage/);
  assert.doesNotMatch(source("../src/integration/unified/Session.tsx"), /connectedCandidate|candidate\/connected/);
  assert.doesNotMatch(source("../src/bootstrap.ts"), /candidate\/connected/);
  assert.doesNotMatch(source("../../scripts/prepare-catalog-candidate-web.mjs"), /connected-main/);
});
