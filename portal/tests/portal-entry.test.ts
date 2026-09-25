import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalPortalBase, parseRoute } from "../src/app/routes";
import { portalSurface } from "../src/feature-flags";
import { accountCacheKey, createAccountSession } from "../src/integration/account-session";
import { loadSetData, emptyAccount } from "../src/integration/data";
import { setInstallLink } from "../src/app/set-install";
import { SetControls } from "../src/integration/SetControls";
import { PrivateSourcesPanel } from "../src/integration/PrivateSourcesPanel";
import type { PortalApi } from "../src/portal-api";
import { makeFixtures } from "../src/preview/fixtures";

const deepLink = `omgskills://group?url=${encodeURIComponent("https://omgskills.com/u/test-owner/sets/my-set")}`;
const noOp = () => {};

test("normal routes support /app and the app host root, without consuming pairing", () => {
  for (const base of ["/app/", "/"]) {
    for (const page of ["", "agents", "sets", "home", "groups/example", "groups/example/"]) {
      const path = base + page;
      assert.equal(normalPortalBase(path), base);
      assert.notEqual(parseRoute(path, "", base).page, "missing");
      assert.equal(portalSurface(path, true), "dashboard");
      assert.equal(portalSurface(path, false), "disabled");
    }
    assert.equal(portalSurface(base + "connect", true), "connect");
    assert.equal(parseRoute(base + "connect", "", base).page, "missing");
  }
  assert.equal(normalPortalBase("/app"), "/app/");
  assert.equal(parseRoute("/app", "", "/app/").page, "skills");
  assert.equal(parseRoute("/app/unknown", "", "/app/").page, "missing");
});

test("normal and local account caches never hydrate each other's snapshots", () => {
  const identity = { name: "Test account", email: "test@example.test" };
  const keys = ["integration", "local-app", "app"].map((mode) => accountCacheKey("instance", "user", "session", mode as "integration" | "local-app" | "app"));
  assert.equal(new Set(keys).size, 3);
  const values = new Map([[keys[0], JSON.stringify({ at: Date.now(), data: emptyAccount(identity) })]]);
  const session = createAccountSession({ identity, cacheKey: keys[2], api: async () => { throw new Error("No network expected"); },
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } }, changed: noOp });
  assert.equal(session.getSnapshot().data, null);
  session.dispose();
  assert.ok(values.has(keys[0]));
});

test("detail retains the server's install link, including older responses without it", async () => {
  const group = makeFixtures().sets[1];
  for (const appDeepLink of [deepLink, undefined]) {
    const result = await loadSetData(async <T>() => ({ group: { ...group, appDeepLink }, accessRole: "owner", items: [] }) as T, group.id);
    assert.equal(result.appDeepLink, appDeepLink ?? null);
  }
});

test("install actions require the Mac gate, a valid link and a nonlocal authorized detail", () => {
  for (const role of ["owner", "invited", "public"] as const) for (const local of [true, false]) for (const installEnabled of [true, false]) {
    const html = renderToStaticMarkup(createElement(SetControls, { page: "detail", set: { ...makeFixtures().sets[1], role, appDeepLink: deepLink },
      local, installEnabled, blocked: false, saving: false, save: async () => { throw new Error("No writes expected"); }, navigate: noOp, notify: noOp }));
    assert.equal(html.includes("omgskills://group"), installEnabled && !local);
  }
  for (const value of [undefined, "javascript:alert(1)", "https://omgskills.com", deepLink + "&url=x", "omgskills://other?url=x",
    `omgskills://group?url=${encodeURIComponent("https://evil.example/u/test-owner/sets/my-set")}`]) {
    assert.equal(setInstallLink(value, true, false), null);
  }
  assert.equal(setInstallLink(deepLink, true, false), deepLink);
});

test("the real private-source panel does not claim its backend is simulated", () => {
  const api: PortalApi = async () => { throw new Error("SSR must not request data"); };
  for (const local of [true, false]) {
    const html = renderToStaticMarkup(createElement(PrivateSourcesPanel, { api, denied: noOp, local }));
    assert.equal(html.includes("Local GitHub simulation"), local);
  }
});

test("entry wiring defaults the redesign off and retains guards, auth returns and visible failures", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const bootstrap = await read("../src/bootstrap.ts");
  assert.match(bootstrap, /VITE_PORTAL_REDESIGN_ENABLED === "1"/);
  assert.match(bootstrap, /portalSurface\(location.pathname, isFeatureEnabled\(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED\)\) === "dashboard"/);
  assert.match(bootstrap, /import\("\.\/main"\)/);
  const entry = await read("../src/redesign-main.tsx");
  assert.match(entry, /integrationConfigurationError/);
  assert.match(entry, /installEnabled=\{!local && isFeatureEnabled/);
  const session = await read("../src/account/PortalSession.tsx");
  assert.match(session, /local \|\| snapshot.error \|\| membership.error \|\| snapshot.accessDenied/);
  assert.match(session, /forceRedirectUrl=\{window.location.href\}/);
  assert.match(session, /signOut\(\{ sessionId, redirectUrl: base \}\)/);
  assert.doesNotMatch(session, /preview\/fixtures|testing\//);
  const localEntry = await read("../src/integration/main.tsx");
  assert.match(localEntry, /integrationConfigurationError/);
  assert.match(localEntry, /local installEnabled=\{false\}/);
});
