import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { browserPairingCallbackTarget } from "../../netlify/functions/_shared/browser-pairing";
import { connectedInventoryTestEnabled } from "../src/connected-inventory-test";
import { connectedInventoryServerEnabled, isIntegrationBody, isIntegrationRead, isIntegrationRequest } from "../integration-config";
import { browserPairingCancelUrl, connectedPairingCallback, connectedInventoryDisclosure } from "../src/browser-pairing";
import { loadAccountData, parseConnectedInventory, readOnlyApi } from "../src/integration/data";
import { createAccountSession } from "../src/integration/account-session";
import { managementApi } from "../src/integration/unified/management-api";
import { groupSyncedSkills } from "../src/synced-skill-grouping";
import { initialNavigation, inventorySummary, setSkillDisplays, skillDisplays } from "../src/app/unified/model";
import { isMember } from "../src/app/model";
import type { PortalApi } from "../src/portal-api";
import viteConfig from "../vite.config";

const configuration = { enabled: "1", development: true, integration: "1", ready: true,
  publishableKey: "pk_test_fixture", webEnabled: "1", catalogInstall: "1", hostname: "127.0.0.1", protocol: "http:" };
const env = { VITE_NEWMAC_CONNECTED_INVENTORY_TEST: "1", VITE_PORTAL_INTEGRATION: "1",
  PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_fixture", VITE_SKILLGROUPS_WEB_ENABLED: "1", VITE_NEWMAC_CATALOG_INSTALL_TEST: "1" };
const state = "a".repeat(43);
const approval = { state, codeChallenge: "b".repeat(43), codeChallengeMethod: "S256", scopes: ["sync:write", "self:revoke"] };
const date = "2026-10-16T12:00:00Z";
const identity = { name: "Test", email: "test@example.test" };
const catalog = { skills: [], collections: [], creators: [], categories: [], trendingIds: [] };
function inventory() {
  const skill = { id: "physical-a", name: "Same skill", description: "Same description", source: "codex",
    skillMdSha: "a".repeat(40), identityStatus: "localOnly" as const, catalogSkillId: null, githubUrl: null,
    isLocalOnly: true, lastSeenAt: date, deviceId: "mac-a", installationFolder: "same", gitRelativePath: null, catalogSkillIdHint: null };
  return { inventoryVersion: 2, skills: [skill, { ...skill, id: "physical-b", deviceId: "mac-b" },
    { ...skill, id: "physical-c", source: "claude" }, { ...skill, id: "legacy", deviceId: null }],
    devices: [{ id: "mac-a", deviceName: "Work Mac", status: "active", lastReportedAt: date },
      { id: "mac-b", deviceName: "Home Mac", status: "revoked", lastReportedAt: date }] };
}
function accountResponse(path: string, result = inventory()) {
  if (path === "/api/portal/synced-skills?version=2") return result;
  if (path === "/api/portal/synced-skills") return { skills: result.skills.map(({ deviceId: _, ...skill }) => skill) };
  if (path === "/api/portal/groups") return { groups: [{ id: "existing-set", name: "Existing Set", visibility: "private", syncedSkillIds: ["physical-b", "legacy"] }] };
  if (path === "/api/portal/shared") return { groups: [] };
  if (path === "/api/portal/profile") return { profile: { handle: null, profilePublished: false, publicUrl: null } };
  throw Error(`Unexpected read ${path}`);
}
const api: PortalApi = async <T>(path: string) => accountResponse(path) as T;

test("connected gate requires verified dev HTTP loopback integration and test sign-in", () => {
  assert.equal(connectedInventoryTestEnabled(configuration), true);
  assert.equal(connectedInventoryTestEnabled({ ...configuration, enabled: undefined }), false);
  assert.equal(connectedInventoryTestEnabled({ ...configuration, enabled: "0" }), false);
  for (const change of [{ enabled: "true" }, { development: false }, { integration: undefined }, { ready: false },
    { publishableKey: "pk_live_no" }, { publishableKey: undefined }, { webEnabled: "0" }, { catalogInstall: "0" },
    { legacyInstall: "1" }, { preview: "1" }, { hostname: "omgskills.com" }, { hostname: "localhost.evil.test" }, { protocol: "https:" }]) {
    assert.throws(() => connectedInventoryTestEnabled({ ...configuration, ...change }));
  }
  assert.equal(connectedInventoryServerEnabled("serve", env), true);
  assert.equal(connectedInventoryServerEnabled("build", {}), false);
  assert.throws(() => connectedInventoryServerEnabled("build", env));
  for (const change of [{ NODE_ENV: "production" }, { PORTAL_TEST_ENVIRONMENT_VERIFIED: "0" },
    { PORTAL_TEST_API_ORIGIN: "https://omgskills.com" }, { PORTAL_TEST_API_ORIGIN: "http://localhost" },
    { PORTAL_TEST_API_ORIGIN: "http://localhost:8888/api" }, { VITE_PORTAL_INTEGRATION: "0" }]) {
    assert.throws(() => connectedInventoryServerEnabled("serve", { ...env, ...change }));
  }
});

test("exact v2 read requires opt-in at both transport layers without broadening other reads", async () => {
  const paths = ["/api/portal/synced-skills?version=1", "/api/portal/synced-skills?version=02",
    "/api/portal/synced-skills?version=2&version=2", "/api/portal/synced-skills?version=2&x=1",
    "/api/portal/synced-skills?%76ersion=2", "/api/portal/synced-skills/?version=2", "/api/portal/profile?version=2"];
  for (const path of paths) {
    assert.equal(isIntegrationRead(path, "GET", true), false);
    assert.equal(isIntegrationRequest(path, "GET", true), false);
    await assert.rejects(readOnlyApi(api, undefined, true)(path));
    await assert.rejects(managementApi(api, true)(path));
  }
  const path = "/api/portal/synced-skills?version=2";
  assert.equal(isIntegrationRequest(path), false);
  await assert.rejects(readOnlyApi(api)(path));
  await assert.rejects(managementApi(api)(path));
  assert.equal(isIntegrationRead(path, "POST", true), false);
  await assert.rejects(readOnlyApi(api, undefined, true)(path, { body: "{}" }));
  assert.equal((await readOnlyApi(api, undefined, true)<ReturnType<typeof inventory>>(path)).inventoryVersion, 2);
  for (const blocked of ["sync-upload", "sync-exchange", "install-package"]) {
    assert.equal(isIntegrationRequest(`/api/portal/${blocked}`, "POST", true), false);
  }
});

test("PKCE approval allowlist accepts the existing exact body only in connected mode", () => {
  const path = "/api/portal/sync-pairing-code";
  assert.equal(isIntegrationBody(path, "POST", {}), true);
  assert.equal(isIntegrationBody(path, "POST", approval), false);
  assert.equal(isIntegrationBody(path, "POST", approval, true), true);
  assert.equal(isIntegrationBody(path, "POST", { ...approval, scopes: [...approval.scopes, "content:read"] }, true), true);
  for (const body of [null, [], { state }, { ...approval, state: "bad" }, { ...approval, codeChallenge: "bad" },
    { ...approval, codeChallengeMethod: "plain" }, { ...approval, scopes: ["sync:write"] },
    { ...approval, scopes: [...approval.scopes, "sync:write"] }, { ...approval, scopes: [...approval.scopes, "admin"] },
    { ...approval, callbackUrl: "omgskills-f1://pair" }, { ...approval, redirect_uri: "https://evil.test" }]) {
    assert.equal(isIntegrationBody(path, "POST", body, true), false);
  }
  assert.equal(isIntegrationBody("/api/portal/sync-token", "POST", approval, true), false);
});

test("F1 cancel and approved callback retain state, reject arbitrary and production targets", () => {
  const cancel = new URL(browserPairingCancelUrl(state, true));
  assert.equal(cancel.protocol, "omgskills-f1:");
  assert.equal(cancel.host, "pair");
  assert.deepEqual(Object.fromEntries(cancel.searchParams), { error: "access_denied", state });
  assert.equal(new URL(browserPairingCancelUrl(state)).protocol, "omgskills:");
  const callback = `omgskills-f1://pair?code=pair_${"c".repeat(43)}&state=${state}`;
  assert.equal(connectedPairingCallback(callback, state), callback);
  for (const bad of [callback.replace("omgskills-f1", "omgskills"), callback.replace("pair?", "other?"),
    callback + "&state=" + state, callback + "&callbackUrl=https://evil.test", callback + "#extra", callback.replace("pair_c", "device_c")]) {
    assert.throws(() => connectedPairingCallback(bad, state));
  }
  assert.throws(() => connectedPairingCallback(callback, "d".repeat(43)));
  assert.throws(() => browserPairingCancelUrl("bad", true));
  for (const text of ["names", "descriptions", "folder", "fingerprint", "safe source", "outside OMGSkills"]) assert.ok(connectedInventoryDisclosure.includes(text));
});

test("v2 maps physical rows, device/report metadata and existing Set IDs without stableKey", async () => {
  const data = await loadAccountData(readOnlyApi(api, undefined, true), identity, false, true);
  assert.equal(data.inventoryVersion, 2);
  assert.deepEqual(data.skills.map(skill => skill.id), ["physical-a", "physical-b", "physical-c", "legacy"]);
  assert.equal(data.skills[0].deviceName, "Work Mac");
  assert.equal(data.skills[1].deviceStatus, "revoked");
  assert.equal(data.skills[1].lastReportedAt, date);
  assert.equal(data.skills[0].installationFolder, "same");
  assert.equal(data.skills[3].deviceId, null);
  const grouped = groupSyncedSkills(data.skills);
  assert.equal(grouped.length, 4);
  const home = grouped.find(skill => skill.id === "physical-b")!;
  assert.equal(isMember(data.sets[0], home), true);
  assert.deepEqual(home.allSkillIds, ["physical-b"]);
  assert.match(inventorySummary(home)!.location, /Home Mac \/ codex/);
  assert.match(inventorySummary(home)!.report, /Last known \(revoked\).*Last reported/);
  assert.match(inventorySummary(grouped.find(skill => skill.id === "legacy")!)!.location, /Unknown Mac/);
  const mine = skillDisplays(data, catalog).mine;
  const [saved] = setSkillDisplays({ ...data.sets[0], items: [{ id: "item-1", kind: "synced", syncedSkillId: "physical-b", name: "Saved", description: "", githubUrl: null }] }, mine);
  assert.equal(saved.installed?.id, "physical-b");
  assert.equal(saved.setItemId, "item-1");
  const legacy = await loadAccountData(api, identity);
  assert.equal(legacy.inventoryVersion, undefined);
  assert.deepEqual(legacy.devices, []);
  assert.equal(legacy.skills[0].inventoryVersion, undefined);
});

test("same catalog identities and same Mac names cannot collapse v2 physical installations", () => {
  const result = inventory();
  result.devices[1].deviceName = result.devices[0].deviceName;
  const data = parseConnectedInventory(result);
  const grouped = groupSyncedSkills(data.skills.map(skill => ({ ...skill, catalogSkillId: "owner/repo:same" })));
  assert.equal(grouped.length, 4);
  assert.deepEqual(new Set(grouped.flatMap(skill => skill.allSkillIds)), new Set(result.skills.map(skill => skill.id)));
  assert.equal(groupSyncedSkills(result.skills.map(({ deviceId: _, ...skill }) => skill)).length, 1, "Legacy grouping stays unchanged");
  const missingMac = parseConnectedInventory({ ...result, devices: [] });
  assert.equal(missingMac.skills[0].deviceId, "mac-a");
  assert.match(inventorySummary(groupSyncedSkills(missingMac.skills)[0])!.location, /Unknown Mac/);
});

test("real unified list groups identical skills but retains each Mac, agent and last-known report", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { UnifiedApp: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }) } });
    const noOp = () => {};
    const data = await loadAccountData(readOnlyApi(api, undefined, true), identity, false, true);
    const html = renderToStaticMarkup(createElement(module.exports.UnifiedApp, { data, catalog, nav: initialNavigation,
      signedIn: true, readOnlyAccount: true, state: "ready", navigate: noOp, onSession: noOp, onFavorite: noOp,
      onCreateSet: noOp, onMembership: noOp, onVisibility: noOp, retry: noOp }));
    assert.equal([...html.matchAll(/aria-label="Open Same skill"/g)].length, 1);
    assert.match(html, /aria-label="Installed in 2 agents"/);
    // Each Mac's report stays out of the row; the skill panel shows it behind "Show history".
    for (const text of ["Work Mac / codex", "Home Mac / codex", "Unknown Mac / codex", "Last known (revoked)", "Last reported"]) assert.ok(!html.includes(text), text);
    assert.doesNotMatch(html, /Currently live|Currently installed/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("invalid v2 responses fail closed rather than falling back or erasing a known inventory", () => {
  const valid = inventory();
  for (const bad of [{ ...valid, inventoryVersion: 1 }, { skills: valid.skills }, { ...valid, devices: null },
    { ...valid, skills: [valid.skills[0], valid.skills[0]] }, { ...valid, devices: [valid.devices[0], valid.devices[0]] },
    { ...valid, skills: [{ ...valid.skills[0], deviceId: undefined }] }, { ...valid, skills: [{ ...valid.skills[0], lastSeenAt: "bad" }] },
    { ...valid, devices: [{ ...valid.devices[0], lastReportedAt: "bad" }] }]) assert.throws(() => parseConnectedInventory(bad));
});

test("connected sessions stay memory-only, refresh v2 after Set saves and preserve stale rows", async () => {
  const paths: string[] = [];
  let fail = false;
  const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
    paths.push(path);
    if (init?.method === "PATCH") return { groupId: "existing-set", name: "Renamed", description: "", visibility: "private" } as T;
    if (fail) throw Error("Offline");
    return accountResponse(path) as T;
  };
  let storageAccesses = 0;
  const storage = { getItem() { storageAccesses++; return null; }, setItem() { storageAccesses++; }, removeItem() { storageAccesses++; } };
  const session = createAccountSession({ api: managementApi(transport, true), identity, cacheKey: "connected", storage, connectedInventory: true, changed() {} });
  await session.refresh();
  assert.equal(session.getSnapshot().data?.skills.length, 4);
  await session.saveSet({ kind: "update", id: "existing-set", changes: { name: "Renamed", description: "", visibility: "private" } });
  assert.equal(paths.filter(path => path === "/api/portal/synced-skills?version=2").length, 2);
  assert.ok(!paths.includes("/api/portal/synced-skills"));
  fail = true;
  await session.refresh();
  assert.equal(session.getSnapshot().data?.skills.length, 4);
  assert.match(session.getSnapshot().error, /last loaded/);
  session.dispose();
  assert.equal(storageAccesses, 0);
});

test("connected Set actions use only the selected physical ID and keep existing item IDs", async () => {
  const writes: unknown[] = [];
  const items = [{ id: "existing-item", kind: "synced", syncedSkillId: "physical-b", name: "Saved", description: "", githubUrl: null, position: 0 }];
  const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      items.push({ ...items[0], id: "new-item", syncedSkillId: body.syncedSkillId, position: 1 });
      return { itemId: "new-item" } as T;
    }
    if (path === "/api/portal/groups/existing-set") return {
      group: { id: "existing-set", name: "Existing Set", visibility: "private" },
      accessRole: "owner", items: items.map(item => ({ ...item })),
    } as T;
    return accountResponse(path) as T;
  };
  const session = createAccountSession({ api: managementApi(transport, true), identity,
    cacheKey: "connected-set", connectedInventory: true, changed() {} });
  try {
    await session.refresh();
    const selected = groupSyncedSkills(session.getSnapshot().data!.skills).find(skill => skill.id === "physical-a")!;
    const result = await session.saveMembership({ kind: "change", id: "existing-set", skills: [selected], add: true });
    assert.equal(result.added, 1);
    assert.deepEqual(writes, [{ kind: "synced", syncedSkillId: "physical-a" }]);
    assert.equal(items[0].id, "existing-item");
    assert.equal(items[0].syncedSkillId, "physical-b");
    assert.deepEqual(session.getSnapshot().data?.sets[0].membershipSkillIds, ["physical-b", "legacy"]);
    assert.equal(session.getSnapshot().data?.skills.length, 4);
  } finally { session.dispose(); }
});

test("disposed or unauthorized connected accounts ignore late device/skill/Set reads", async () => {
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const delayed: PortalApi = <T>(path: string, init?: RequestInit) => new Promise<T>(resolve => {
    signals.push(init!.signal!); releases.push(() => resolve(accountResponse(path) as T));
  });
  const old = createAccountSession({ api: delayed, identity, cacheKey: "old", connectedInventory: true, changed() {} });
  const pending = old.refresh(); old.dispose();
  let hold = false;
  const replacement: PortalApi = (path, init) => hold ? delayed(path, init) : api(path, init);
  const next = createAccountSession({ api: replacement, identity: { ...identity, name: "New" }, cacheKey: "new", connectedInventory: true, changed() {} });
  await next.refresh();
  releases.forEach(release => release()); await pending;
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(old.getSnapshot().data, null);
  assert.equal(next.getSnapshot().data?.profile.name, "New");
  assert.equal(next.getSnapshot().data?.devices.length, 2);
  hold = true;
  const start = releases.length;
  const late = next.refresh();
  next.invalidateAccess();
  releases.slice(start).forEach(release => release());
  await late;
  assert.equal(next.getSnapshot().data, null);
  assert.ok(signals.every(signal => signal.aborted));
  next.dispose();
});

test("normal app entry validates before routing, keeps connect in the consent page and wires v2", () => {
  const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source("bootstrap.ts"), /connectedInventoryTest &&/);
  assert.ok(source("bootstrap.ts").indexOf('import("./review/main")') < source("bootstrap.ts").indexOf('import("./unified-main")'));
  assert.match(source("unified-main.tsx"), /connectedInventory=\{connectedInventoryTest \|\| production.inventory\}/);
  assert.match(source("integration/unified/useAccount.ts"), /connectedInventory,/);
  assert.match(source("main.tsx"), /connectedInventoryTest \? f1PairingConsent : normalPairingConsent\}/);
  assert.match(source("ConnectPage.tsx"), /policy.disclosure && <p>\{policy.disclosure\}/);
  assert.doesNotMatch(source("main.tsx"), /callbackUrl:\s*request/);
});

test("ephemeral Vite proxy delivers consumed PKCE bytes and exact backend origin", { timeout: 20000, skip: process.env.PORTAL_SKIP_SERVER_TESTS === "1" }, async () => {
  for (const hostname of ["127.0.0.1", "localhost"]) {
    const received: { body: string; origin: string; callback: string }[] = [];
    let backendOrigin = "";
    const backend = createHttpServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(`http://${req.headers.host}${req.url}`, { headers: { origin: String(req.headers.origin) } });
        const callback = browserPairingCallbackTarget(request, {
          OMGSKILLS_CONNECTED_INVENTORY_TEST: "1", CONTEXT: "dev", NODE_ENV: "development",
          PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", PORTAL_TEST_API_ORIGIN: backendOrigin,
        });
        received.push({ body: Buffer.concat(chunks).toString(), origin: new URL(request.url).origin, callback });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ callbackUrl: `${callback}?code=pair_${"c".repeat(43)}&state=${state}` }));
      } catch {
        res.statusCode = 503; res.end("Backend origin validation failed");
      }
    });
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
    const overrides = { ...env, NODE_ENV: "development", VITE_NEWMAC_WEB_INSTALL_TEST: "0", VITE_NEWMAC_F1: "0", VITE_NEWMAC_SETUP_TEST: "0", VITE_PORTAL_PREVIEW: "0" };
    const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
    try {
      await new Promise<void>((resolve, reject) => { backend.once("error", reject); backend.listen(0, hostname, resolve); });
      const address = backend.address();
      assert.ok(address && typeof address !== "string");
      backendOrigin = `http://${hostname}:${address.port}`;
      Object.assign(process.env, { ...overrides, PORTAL_TEST_API_ORIGIN: backendOrigin });
      const config = (viteConfig as Function)({ command: "serve", mode: "test" });
      vite = await createViteServer({ ...config, configFile: false,
        root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent",
        server: { ...config.server, host: "127.0.0.1", port: 0, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      await vite.listen();
      const browserAddress = vite.httpServer!.address();
      assert.ok(browserAddress && typeof browserAddress !== "string");
      const browserOrigin = `http://127.0.0.1:${browserAddress.port}`;
      const body = JSON.stringify(approval, null, 2);
      const response = await fetch(`${browserOrigin}/api/portal/sync-pairing-code`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: browserOrigin }, body,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { callbackUrl: string };
      assert.equal(connectedPairingCallback(result.callbackUrl, state), result.callbackUrl);
      assert.deepEqual(received, [{ body, origin: backendOrigin, callback: "omgskills-f1://pair" }]);
      const denied = await fetch(`${browserOrigin}/api/portal/sync-pairing-code`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: browserOrigin },
        body: JSON.stringify({ ...approval, callbackUrl: "https://evil.test" }),
      });
      assert.equal(denied.status, 400);
      await denied.text();
      assert.equal(received.length, 1);
    } finally {
      await vite?.close();
      backend.closeAllConnections();
      if (backend.listening) await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
      assert.equal(backend.listening, false);
      if (vite) assert.equal(vite.httpServer?.listening, false);
      for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }
});

test("Vite pairing guard validates and replays exact bytes without starting a server", async () => {
  const overrides = { ...env, NODE_ENV: "development", VITE_NEWMAC_WEB_INSTALL_TEST: "0", VITE_NEWMAC_F1: "0", VITE_NEWMAC_SETUP_TEST: "0", VITE_PORTAL_PREVIEW: "0" };
  const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const config = (viteConfig as Function)({ command: "serve", mode: "test" });
    const plugin = config.plugins.find((item: { name?: string }) => item.name === "isolated-portal-access");
    const catalogPlugin = config.plugins.find((item: { name?: string }) => item.name === "local-catalog-install-test");
    assert.equal(config.server.host, "127.0.0.1");
    assert.throws(() => catalogPlugin.configResolved({ server: { host: "0.0.0.0" } }));
    let middleware!: Function;
    plugin.configureServer({ middlewares: { use(fn: Function) { middleware = fn; } } });
    let replay!: Function;
    config.server.proxy["/api/portal"].configure({ on(event: string, fn: Function) { assert.equal(event, "proxyReq"); replay = fn; } });
    for (const body of [JSON.stringify(approval), JSON.stringify({ ...approval, callbackUrl: "omgskills://pair" }), "not json", " ".repeat(8193)]) {
      const req = Object.assign(new PassThrough(), { url: "/api/portal/sync-pairing-code", method: "POST" });
      const res = { statusCode: 200, writableEnded: false, setHeader() {}, end() { this.writableEnded = true; } };
      let forwarded = false;
      middleware(req, res, () => { forwarded = true; });
      req.end(body);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(forwarded, body === JSON.stringify(approval));
      if (forwarded) {
        let bytes = "";
        replay({ setHeader() {}, removeHeader() {}, write(value: Buffer) { bytes += value.toString(); } }, req);
        assert.equal(bytes, body);
      } else assert.equal(res.statusCode, 400);
    }
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
