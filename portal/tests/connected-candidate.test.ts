import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createPairingConsent, f1PairingConsent, normalPairingConsent,
  type PairingConsentPolicy } from "../src/browser-pairing";
import { connectedCandidateOrigin as origin, connectedCandidateConsent as consent,
  connectedClerkFrontend, requireConnectedCandidateBrowser, connectedCandidateReturnUrl,
  connectedCandidateNavigation, isConnectedCandidateBrowserRequest, connectedCandidateBrowserApi } from "../src/candidate/connected-policy";
import { initialNavigation } from "../src/app/unified/model";
import { createAccountSession, type AccountSnapshot } from "../src/integration/account-session";
import { PortalApiError } from "../src/api-error";
import { createDeviceSession } from "../src/integration/device-session";
import type { PortalApi } from "../src/portal-api";
import type { UnifiedApp } from "../src/app/unified/UnifiedApp";
import type { PortalData } from "../src/app/model";
import type { CatalogInstallIntentStore } from "../src/app/unified/catalog-install-intent";
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

const handshake = "__clerk_handshake=synthetic-not-a-token";
test("bootstrap accepts the Clerk handshake without retaining it in application return URLs", () => {
  for (const path of ["/app/", "/app/?view=all", "/app/?view=discover&skill=catalog%3Aa%2Fb", "/app/connect" + hash]) {
    const clean = origin + path;
    const decorated = new URL(clean);
    decorated.searchParams.append("__clerk_handshake", "synthetic-not-a-token");
    assert.equal(connectedCandidateReturnUrl(decorated.href), null, "Auth callbacks are not application return links");
    const validated = requireConnectedCandidateBrowser(config, decorated.href);
    assert.equal(validated.returnUrl, clean);
    assert.equal(validated.route, path.startsWith("/app/connect") ? "connect" : "app");
    assert.doesNotMatch(validated.returnUrl, /__clerk|synthetic-not-a-token/);
    assert.equal(decorated.searchParams.get("__clerk_handshake"), "synthetic-not-a-token");
  }
});

test("handshake bootstrap keeps origin, route, configuration and unknown-query restrictions", () => {
  for (const url of [
    "https://omgskills.com/app/?" + handshake, origin + ".evil.test/app/?" + handshake,
    origin.replace("https://", "https://user:password@") + "/app/?" + handshake,
    origin + "/app/index.html?" + handshake, origin + "/app/?" + handshake + "#unexpected",
    origin + "/app/?" + handshake + "&redirect=https://evil.test",
    origin + "/app/?" + handshake + "&__clerk_unrecognized=value",
    origin + "/app/?" + handshake + "&view=all&view=discover",
    origin + "/app/?" + handshake + "&" + handshake,
    origin + "/app/?__clerk_handshake=", origin + "/app/?__clerk_handshake",
    origin + "/app/connect?" + handshake,
    origin + "/app/connect?" + handshake + hash + "&state=duplicate",
    origin + "/app/connect?" + handshake + "&redirect=https://evil.test" + hash,
  ]) assert.throws(() => requireConnectedCandidateBrowser(config, url), undefined, url);
  for (const invalid of [{ ...config, profile: "other" }, { ...config, publishableKey: "pk_live_ignored" },
    { ...config, clerkFrontendOrigin: "https://other.clerk.accounts.dev" }]) {
    assert.throws(() => requireConnectedCandidateBrowser(invalid, origin + "/app/?" + handshake));
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

test("connected entry is explicitly selected without changing normal/F1 bootstrap or install-only defaults", async () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../src/main.tsx"), /<ConnectPage policy=\{inventoryConnection !== "none" \? productionConsent\s*:\s*connectedInventoryTest \? f1PairingConsent : normalPairingConsent\}/);
  assert.doesNotMatch(source("../src/main.tsx"), /candidate\/connected-policy|function ConnectPage/);
  assert.doesNotMatch(source("../src/integration/unified/Session.tsx"), /connectedCandidate|candidate\/connected/);
  assert.doesNotMatch(source("../src/bootstrap.ts"), /candidate\/connected/);
  const { candidateBuildOptions, hostingFiles } = await import("../../scripts/prepare-catalog-candidate-web.mjs");
  const html = source("../index.html");
  const entry = (options: ReturnType<typeof candidateBuildOptions>) => options.plugins
    .find((plugin: { name: string }) => plugin.name === "catalog-candidate-entry-only").transformIndexHtml.handler(html);
  const output = "/private/tmp/cc2b3-pure-options-not-written";
  const defaults = candidateBuildOptions(output);
  const installOnly = candidateBuildOptions(output, { profile: "install-only" });
  assert.equal(entry(defaults), entry(installOnly));
  assert.match(entry(defaults), /src\/candidate\/main.tsx/);
  assert.doesNotMatch(entry(defaults), /connected-main/);
  assert.equal(defaults.define, undefined);
  assert.doesNotMatch(hostingFiles()._redirects, /\/app\/connect/);
  assert.throws(() => candidateBuildOptions(output, { profile: "connected" }));
  const connected = candidateBuildOptions(output, config);
  assert.match(entry(connected), /src\/candidate\/connected-main.tsx/);
  assert.doesNotMatch(entry(connected), /src\/bootstrap.ts|src\/candidate\/main.tsx/);
  assert.deepEqual(JSON.parse(connected.define.__OMGSKILLS_CONNECTED_CANDIDATE__), config);
  assert.match(hostingFiles(config)._redirects, /^\/app\/connect \/app\/index.html 200$/m);
});

const favoriteId = "11111111-1111-4111-8111-111111111111";
const observed = "2026-10-16T12:00:00Z", reported = "2026-10-19T12:00:00Z";
const identity = { name: "Candidate user", email: "candidate@example.test" };
function accountResponse(path: string) {
  if (path === "/api/portal/synced-skills?version=3") return { inventoryVersion: 3,
    skills: ["mac-a", "mac-b", null].map((deviceId, index) => ({ id: `physical-${index}`, name: "Installed skill",
      description: "Retained skill", source: index === 1 ? "claude" : "codex", deviceId, installationFolder: "skill",
      githubUrl: null, isLocalOnly: true, isCurrent: index !== 0, lastSeenAt: observed })),
    devices: [{ id: "mac-a", deviceName: "Mac A", status: "active", lastReportedAt: reported, lastCheckedAt: reported,
      scanCoverage: [{ source: "codex", state: "incomplete", reason: "changed" }, { source: "claude", state: "complete" }, { source: "agents", state: "complete" }] },
    { id: "mac-b", deviceName: "Mac B", status: "revoked", lastReportedAt: reported, lastCheckedAt: null, scanCoverage: null }] };
  const favorite = { id: favoriteId, name: "Favorite Skills", isFavorites: true, visibility: "public", itemCount: 1,
    syncedSkillIds: ["physical-0"], allowedEmails: [] };
  if (path === "/api/portal/groups") return { groups: [favorite] };
  if (path === "/api/portal/shared") return { groups: [] };
  if (path === "/api/portal/profile") return { profile: { handle: "candidate", profilePublished: true, publicUrl: origin + "/u/candidate" } };
  if (path === `/api/portal/groups/${favoriteId}`) return { group: favorite, accessRole: "owner", items: [
    { id: "saved-item", kind: "synced", syncedSkillId: "physical-0", name: "Saved skill", description: "Saved note", githubUrl: null, position: 0 },
  ] };
  assert.fail(`Unexpected candidate read ${path}`);
}

test("candidate real account session refreshes retained per-Mac inventory and Favorites without enabling writes", async () => {
  const requests: string[] = [], writes: string[] = [];
  let fail = 0, storageCalls = 0;
  const api = connectedCandidateBrowserApi(async <T>(path: string, init?: RequestInit) => {
    requests.push(path); if ((init?.method ?? "GET") !== "GET") writes.push(path);
    if (fail) throw new PortalApiError("Synthetic failure", fail);
    return structuredClone(accountResponse(path)) as T;
  });
  const session = createAccountSession({ api, identity, cacheKey: "candidate-test", connectedInventory: true,
    inventoryReconciliation: true, includeFavoriteItems: true, changed() {}, storage: {
      getItem() { storageCalls++; return null; }, setItem() { storageCalls++; }, removeItem() { storageCalls++; },
    } });
  await session.refresh();
  const before = session.getSnapshot().data!;
  assert.equal(before.inventoryVersion, 3); assert.equal(before.skills.length, 3);
  assert.equal(before.skills[0].isCurrent, false); assert.equal(before.skills[0].lastSeenAt, observed);
  assert.equal(before.devices[0].lastCheckedAt, reported); assert.equal(before.devices[1].status, "revoked");
  assert.equal(before.skills[2].deviceId, null); assert.equal(before.sets[0].items[0].id, "saved-item");
  await session.refresh(); assert.deepEqual(session.getSnapshot().data, before);
  const readCount = requests.length;
  await assert.rejects(session.saveProfile({ handle: "not-allowed" }));
  await assert.rejects(session.saveSet({ kind: "create", name: "Not allowed" }));
  assert.deepEqual(writes, []);
  assert.equal(requests.length, readCount);
  fail = 503; await session.refresh();
  assert.deepEqual(session.getSnapshot().data, before); assert.match(session.getSnapshot().error, /last loaded/);
  fail = 0; await session.refresh(); assert.equal(session.getSnapshot().error, "");
  fail = 401; await session.refresh(); assert.equal(session.getSnapshot().data, null);
  assert.equal(session.getSnapshot().accessDenied, true); assert.equal(storageCalls, 0); session.dispose();
});

// Real React rendering with only auth, account snapshot and public-catalog boundaries mocked.
async function compositionFixture(data: PortalData | null = null, href = origin + "/app/",
  options: { initializeClerk?: () => void; captureConsent?: boolean } = {}) {
  const captured: ComponentProps<typeof UnifiedApp>[] = [];
  const consentProps: { pendingHash: string; isCurrent: () => boolean; policy: PairingConsentPolicy }[] = [];
  const signIns: string[] = [], accountCalls: unknown[][] = [];
  let signedIn = false, refreshes = 0, providerMounts = 0, tokenCalls = 0;
  const snapshot: AccountSnapshot = { data, refreshing: false, accessDenied: false, revision: 1,
    error: "", profileError: "", profileSaving: false, setSaving: false };
  const catalog = { skills: [], collections: [], creators: [], categories: [], trendingIds: [] };
  const overrides: Record<string, unknown> = {
    "@clerk/clerk-react": {
      ClerkProvider: ({ children }: { children: React.ReactNode }) => { providerMounts++; options.initializeClerk?.(); return children; },
      useAuth: () => ({ isLoaded: true, isSignedIn: signedIn, userId: "user", sessionId: "session", getToken: async () => { tokenCalls++; return "fake"; } }),
      useUser: () => ({ isLoaded: true, user: { fullName: identity.name, primaryEmailAddress: { emailAddress: identity.email } } }),
      useClerk: () => ({ openSignIn: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => { signIns.push(forceRedirectUrl); }, signOut: async () => {} }),
    },
    "cc2b-account": { useAccount: (...args: unknown[]) => {
      accountCalls.push(args);
      return { snapshot, refresh: () => { refreshes++; }, clear() {}, recover() {}, invalidate() {},
        saveSet() { assert.fail("Candidate must not expose saves"); }, saveProfile() { assert.fail("Candidate must not expose saves"); }, saveMembership() { assert.fail("Candidate must not expose saves"); } };
    } },
    "cc2b-shell": { UnifiedApp: (props: ComponentProps<typeof UnifiedApp>) => { captured.push(props); return createElement("main", null, props.previewBar); }, Modal: () => null },
    "cc2b-public": { usePublicCatalogPreload() {}, usePublicCatalog: () => ({ catalog, status: { list: "ready", detail: "ready", retry() {}, retryDetail() {} } }) },
    "cc2b-consent": { ConnectPage: (props: typeof consentProps[number]) => {
      consentProps.push(props); return createElement("main", null, "Pairing consent");
    } },
  };
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/candidate/connected-app.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    define: { "import.meta.env": JSON.stringify({ DEV: false }) }, loader: { ".css": "empty" }, plugins: [{ name: "fake-boundaries", setup(plugin) {
      for (const [filter, path] of [[/\/useAccount$/, "cc2b-account"], [/\/UnifiedApp$/, "cc2b-shell"], [/\/use-public-catalog$/, "cc2b-public"]] as const) {
        plugin.onResolve({ filter }, () => ({ path, external: true }));
      }
      if (options.captureConsent) plugin.onResolve({ filter: /\/ConnectPage$/ }, () => ({ path: "cc2b-consent", external: true }));
    } }] });
  const require = createRequire(import.meta.url);
  const module = { exports: {} as typeof import("../src/candidate/connected-app") };
  new Function("require", "module", "exports", output.outputFiles[0].text)((id: string) => overrides[id] ?? require(id), module, module.exports);
  const descriptors = ["window", "location", "history"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const location = new URL(href);
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null,
    setItem(key: string, value: string) { stored.set(key, value); }, removeItem(key: string) { stored.delete(key); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, sessionStorage: storage, matchMedia: () => ({ matches: true }) } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: location });
  Object.defineProperty(globalThis, "history", { configurable: true, value: { replaceState() {}, pushState() {} } });
  return { captured, consentProps, signIns, accountCalls, snapshot, stored, exports: module.exports,
    setSignedIn(value: boolean) { signedIn = value; },
    counts: () => ({ refreshes, providerMounts, tokenCalls }),
    restore() { for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}

test("real candidate entry validates before mounting Clerk and signed-out account reads stay disabled", async () => {
  const f = await compositionFixture();
  try {
    for (const invalid of [{ ...config, profile: "other" }, { ...config, publishableKey: "pk_live_ignored" }]) {
      assert.match(renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: invalid })), /unavailable/);
    }
    assert.equal(f.counts().providerMounts, 0); assert.deepEqual(f.accountCalls, []);
    renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    assert.equal(f.counts().providerMounts, 1);
    assert.equal(f.accountCalls[0][2], false); assert.equal(f.accountCalls[0][4], true);
    assert.equal(f.accountCalls[0][5], true); assert.equal(f.accountCalls[0][6], true);
    assert.equal(f.captured[0].signedIn, false); assert.equal(f.captured[0].management, undefined);
    f.captured[0].onSignIn!(); assert.deepEqual(f.signIns, [origin + "/app/?view=discover"]);
    assert.equal(f.counts().tokenCalls, 0);
    assert.equal(f.stored.size, 0);
  } finally { f.restore(); }
});

test("callback entry leaves the opaque handshake for Clerk and does not enable signed-out account access", async () => {
  const clean = origin + "/app/?view=all", decorated = clean + "&" + handshake;
  const providerLocations: string[] = [];
  const f = await compositionFixture(null, decorated, { initializeClerk() {
    providerLocations.push(window.location.href);
    window.location.href = clean;
  } });
  try {
    const html = renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    assert.doesNotMatch(html, /Connected candidate unavailable/);
    assert.deepEqual(providerLocations, [decorated], "Only Clerk gets the original callback URL");
    assert.equal(window.location.href, clean);
    assert.equal(f.counts().providerMounts, 1);
    assert.equal(f.accountCalls[0][2], false);
    assert.equal(f.captured[0].signedIn, false);
    assert.equal(f.counts().tokenCalls, 0);
    assert.equal(f.stored.size, 0);
    f.captured[0].onSignIn!();
    assert.ok(f.signIns.length === 1 && f.signIns[0].startsWith(origin + "/app/"));
    assert.doesNotMatch(f.signIns[0], /__clerk|synthetic-not-a-token/);
  } finally { f.restore(); }
});

test("pairing remains current after Clerk removes the callback, without automatic approval", async () => {
  const clean = origin + "/app/connect" + hash, decorated = origin + "/app/connect?" + handshake + hash;
  const f = await compositionFixture(null, decorated, { captureConsent: true, initializeClerk() {
    assert.equal(window.location.href, decorated);
    window.location.href = clean;
  } });
  try {
    f.setSignedIn(true);
    renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    assert.equal(f.consentProps.length, 1);
    assert.equal(f.consentProps[0].pendingHash, hash);
    const policy = f.consentProps[0].policy;
    assert.equal(policy.disclosure, consent.disclosure);
    assert.deepEqual(policy.scopes(policy.parse(hash)!), ["sync:write", "self:revoke"]);
    assert.equal(f.consentProps[0].isCurrent(), true);
    assert.equal(f.accountCalls.length, 0); assert.equal(f.counts().tokenCalls, 0);
    assert.equal(f.stored.size, 0); assert.deepEqual(f.signIns, []);
    window.location.hash = "#changed";
    assert.equal(f.consentProps[0].isCurrent(), false, "Changing the request still invalidates consent");
  } finally { f.restore(); }
});

test("a callback cannot mount Clerk or account hooks on an unapproved URL", async () => {
  for (const href of [origin + "/app/?" + handshake + "&redirect=https://evil.test",
    "https://omgskills.com/app/?" + handshake, origin + "/app/?" + handshake + "&" + handshake]) {
    const f = await compositionFixture(null, href);
    try {
      assert.match(renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config })), /unavailable/);
      assert.equal(f.counts().providerMounts, 0); assert.equal(f.counts().tokenCalls, 0);
      assert.deepEqual(f.accountCalls, []); assert.equal(f.stored.size, 0);
    } finally { f.restore(); }
  }
});

test("candidate connection sign-in preserves the fragment and never mounts inventory or auto-approves", async () => {
  const href = origin + "/app/connect" + hash;
  const f = await compositionFixture(null, href);
  try {
    const { ConnectionSignIn, ConnectedCandidateApp } = f.exports;
    renderToStaticMarkup(createElement(ConnectedCandidateApp, { configuration: config }));
    assert.equal(f.accountCalls.length, 0); assert.equal(f.counts().tokenCalls, 0);
    const tree = ConnectionSignIn({ href, signIn: returnUrl => { f.signIns.push(returnUrl); } });
    const button = elements(tree).find(element => typeof element.props.onClick === "function")!;
    (button.props.onClick as () => void)(); assert.deepEqual(f.signIns, [href]);
    window.location.hash = "#invalid";
    (button.props.onClick as () => void)(); assert.equal(f.signIns.length, 1, "A stale sign-in action cannot restore an obsolete request");
    assert.match(renderToStaticMarkup(createElement(ConnectedCandidateApp, { configuration: config })), /unavailable/);
    window.location.hash = hash;
    f.setSignedIn(true);
    const html = renderToStaticMarkup(createElement(ConnectedCandidateApp, { configuration: config }));
    assert.match(html, />Approve</); assert.match(html, />Cancel</); assert.doesNotMatch(html, /Read private skills/);
    assert.equal(f.accountCalls.length, 0); assert.equal(f.counts().tokenCalls, 0);
    assert.equal(window.location.hash, hash);
  } finally { f.restore(); }
});

test("candidate account/device disposal aborts old requests and cannot populate a replacement account", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const signals: AbortSignal[] = [];
  let changes = 0, denied = 0;
  const oldApi = connectedCandidateBrowserApi(async <T>(path: string, init?: RequestInit) => {
    signals.push(init!.signal!); await gate;
    return (path === "/api/portal/devices" ? { devices: [] } : accountResponse(path)) as T;
  });
  const account = createAccountSession({ api: oldApi, identity, cacheKey: "old", connectedInventory: true,
    inventoryReconciliation: true, includeFavoriteItems: true, changed() { changes++; } });
  const devices = createDeviceSession(oldApi, () => { changes++; }, () => { denied++; });
  const pending = [account.refresh(), devices.refresh()];
  account.dispose(); devices.dispose(); const before = changes;
  assert.ok(signals.every(signal => signal.aborted));
  const replacement = createAccountSession({ api: connectedCandidateBrowserApi(async <T>(path: string) => structuredClone(accountResponse(path)) as T),
    identity: { name: "Other account", email: "other@example.test" }, cacheKey: "new", connectedInventory: true,
    inventoryReconciliation: true, includeFavoriteItems: true, changed() {} });
  await replacement.refresh(); const snapshot = replacement.getSnapshot();
  finish(); await Promise.all(pending);
  assert.equal(changes, before); assert.equal(denied, 0); assert.equal(replacement.getSnapshot(), snapshot);
  assert.equal(snapshot.data!.profile.name, "Other account"); replacement.dispose();
});

test("candidate shared composition exposes refresh but no management and uses candidate-only install storage", async () => {
  const session = createAccountSession({ api: connectedCandidateBrowserApi(async <T>(path: string) => structuredClone(accountResponse(path)) as T),
    identity, cacheKey: "render", connectedInventory: true, inventoryReconciliation: true, includeFavoriteItems: true, changed() {} });
  await session.refresh();
  const f = await compositionFixture(session.getSnapshot().data, origin + "/app/?view=all");
  try {
    f.setSignedIn(true);
    const html = renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    const props = f.captured[0];
    assert.match(html, /aria-label="Refresh account"/); assert.equal(props.management, undefined);
    assert.deepEqual(props.supportedAccountViews, ["all", "agents", "devices", "profile"]);
    assert.equal(props.accountPages!("profile", "light"), undefined, "Use the existing read-only profile, never its editor");
    assert.equal(props.accountPages!("github", "light"), undefined);
    const refresh = elements(props.previewBar).find(element => element.props["aria-label"] === "Refresh account")!;
    (refresh.props.onClick as () => void)(); assert.equal(f.counts().refreshes, 1);
    const devices = props.accountPages!("devices", "light") as ReactElement<{ children: ReactElement<{ readOnly: boolean; sessionKey: string; api: PortalApi }> }>;
    assert.equal(devices.props.children.props.readOnly, true); assert.equal(devices.props.children.props.sessionKey, "user:session");
    await assert.rejects(devices.props.children.props.api("/api/portal/devices/other", { method: "DELETE" }));
    assert.equal(f.counts().tokenCalls, 0);
    const skill = { key: "catalog:example/repo", catalogId: "example/repo", name: "Skill", author: "example", description: "", tags: [], githubUrl: null };
    const install = props.publicInstallAction!(skill, true) as ReactElement<{ store: CatalogInstallIntentStore; distribution?: unknown }>;
    assert.equal(install.props.store.client, "candidate"); assert.equal(install.props.distribution, undefined);
    assert.match(renderToStaticMarkup(install), /Set up skill management/);
    assert.equal(f.stored.size, 0);
    install.props.store.save({ version: 1, catalogId: skill.catalogId, agent: "codex", createdAt: Date.now(), returnRoute: "/app/?view=discover&skill=catalog%3Aexample%2Frepo" });
    props.navigate({ ...initialNavigation, view: "discover", selected: "catalog:another/repo" });
    assert.equal(install.props.store.read().intent, null, "Changing skills clears the candidate intent");
    f.snapshot.error = "Could not refresh. Showing your last loaded data.";
    assert.match(renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config })), /role="alert"/);
    f.snapshot.accessDenied = true; f.snapshot.data = null;
    renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    const denied = f.captured.at(-1)!; assert.equal(denied.data.skills.length, 0); assert.equal(denied.accountPages, undefined);
  } finally { f.restore(); session.dispose(); }
});

test("real shared candidate screens render inventory history and hide editing/setup actions", async () => {
  const session = createAccountSession({ api: connectedCandidateBrowserApi(async <T>(path: string) => structuredClone(accountResponse(path)) as T),
    identity, cacheKey: "screen", connectedInventory: true, inventoryReconciliation: true, includeFavoriteItems: true, changed() {} });
  await session.refresh();
  const f = await compositionFixture(session.getSnapshot().data, origin + "/app/?view=all");
  try {
    f.setSignedIn(true);
    renderToStaticMarkup(createElement(f.exports.ConnectedCandidateApp, { configuration: config }));
    const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
    const module = { exports: {} as { UnifiedApp: typeof UnifiedApp } };
    new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const props = f.captured[0];
    const render = (view: "all" | "profile" | "devices") => renderToStaticMarkup(createElement(module.exports.UnifiedApp, {
      ...props, nav: { ...initialNavigation, view },
    }));
    const skills = render("all");
    assert.match(skills, /Mac A/); assert.match(skills, /Mac B/); assert.match(skills, /Unknown Mac/);
    assert.match(skills, /Not found on last scan/); assert.match(skills, /Latest scan incomplete/);
    assert.match(skills, /aria-label="Refresh account"/);
    assert.doesNotMatch(skills, /Add to favorites|Create set|aria-label="Favorites"/);
    const profile = render("profile");
    assert.match(profile, /candidate@example.test/); assert.doesNotMatch(profile, /Publish profile|Save profile|Account settings/);
    const devices = render("devices");
    assert.match(devices, /aria-label="Refresh devices"/); assert.doesNotMatch(devices, />Connect app<|>Revoke</);
  } finally { f.restore(); session.dispose(); }
});

test("read-only account hook rejects all save callbacks before transport work", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/integration/unified/useAccount.ts", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
  const module = { exports: {} as typeof import("../src/integration/unified/useAccount") };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  let calls = 0, account!: ReturnType<typeof module.exports.useAccount>;
  function Probe() {
    account = module.exports.useAccount(async <T>() => { calls++; return {} as T; }, identity, true, "read-only", true, true, true);
    return createElement("main");
  }
  renderToStaticMarkup(createElement(Probe));
  await assert.rejects(account.saveProfile({ handle: "forbidden" }), /editing is unavailable/);
  await assert.rejects(account.saveSet({ kind: "create", name: "forbidden" }), /editing is unavailable/);
  await assert.rejects(account.saveMembership({ kind: "create-selected", name: "forbidden", skills: [] }), /editing is unavailable/);
  assert.equal(calls, 0);
});
