import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { inventoryReconciliationTestEnabled } from "../src/connected-inventory-test";
import { inventoryReconciliationServerEnabled, connectedInventoryServerEnabled, isIntegrationRead, isIntegrationRequest, isIntegrationBody } from "../integration-config";
import { loadAccountData, parseConnectedInventory, readOnlyApi } from "../src/integration/data";
import { createAccountSession } from "../src/integration/account-session";
import { managementApi } from "../src/integration/unified/management-api";
import { groupSyncedSkills, type ScanCoverage } from "../src/synced-skill-grouping";
import { inventorySummary, inventoryCoverageSummary, initialNavigation, skillDisplays, setSkillDisplays } from "../src/app/unified/model";
import { isMember } from "../src/app/model";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import type { UnifiedManagement } from "../src/app/unified/management";
import viteConfig from "../vite.config";

const configuration = { enabled: "1", development: true, integration: "1", ready: true,
  publishableKey: "pk_test_fixture", webEnabled: "1", catalogInstall: "1", hostname: "127.0.0.1", protocol: "http:" };
const environment = { VITE_NEWMAC_CONNECTED_INVENTORY_TEST: "1", VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST: "1",
  VITE_PORTAL_INTEGRATION: "1", PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_fixture", VITE_SKILLGROUPS_WEB_ENABLED: "1", VITE_NEWMAC_CATALOG_INSTALL_TEST: "1" };
const observed = "2026-10-16T12:00:00Z";
const reported = "2026-10-16T15:00:00Z";
const identity = { name: "Test account", email: "test@example.test" };
const catalog = { skills: [], collections: [], creators: [], categories: [], trendingIds: [] };
const v3Path = "/api/portal/synced-skills?version=3";
const complete: ScanCoverage[] = ["claude", "codex", "agents"].map(source => ({ source: source as ScanCoverage["source"], state: "complete" }));
const incomplete: ScanCoverage[] = complete.map(root => root.source === "codex" ? { ...root, state: "incomplete", reason: "changed" } : root);
function inventory() {
  const skill = { id: "missing-id", name: "Removal fixture", description: "Retained installation", source: "codex",
    githubUrl: null, catalogSkillId: "owner/repo:fixture", isLocalOnly: true, lastSeenAt: observed,
    deviceId: "mac-a", installationFolder: "fixture", isCurrent: false };
  return { inventoryVersion: 3, skills: [skill, { ...skill, id: "other-mac", deviceId: "mac-b", isCurrent: true, lastSeenAt: reported },
    { ...skill, id: "legacy", deviceId: null, isCurrent: true }],
    devices: [{ id: "mac-a", deviceName: "Test Mac", status: "active", lastReportedAt: reported, scanCoverage: incomplete as ScanCoverage[] | null },
      { id: "mac-b", deviceName: "Test Mac", status: "revoked", lastReportedAt: reported, scanCoverage: complete as ScanCoverage[] | null }] };
}
function response(path: string, result: unknown = inventory()) {
  if (path === v3Path) return result;
  if (path === "/api/portal/groups") return { groups: [{ id: "saved-set", name: "Retained Set", visibility: "private", syncedSkillIds: ["missing-id"], itemCount: 1 }] };
  if (path === "/api/portal/shared") return { groups: [] };
  if (path === "/api/portal/profile") return { profile: { handle: null, profilePublished: false, publicUrl: null } };
  throw new Error(`Unexpected read ${path}`);
}
const api: PortalApi = async <T>(path: string) => response(path) as T;
const load = (result = inventory()) => loadAccountData(readOnlyApi(async <T>(path: string) => response(path, result) as T, undefined, true, true), identity, false, true, true);

test("check freshness stays device-scoped and separate from reported and seen dates", async () => {
  const before = inventory();
  const checked = "2026-10-16T16:00:00.123Z";
  const result = { ...before, devices: before.devices.map((device, i) => ({ ...device, lastCheckedAt: i === 0 ? checked : null })) };
  const parsed = parseConnectedInventory(result, 3);
  assert.equal(parsed.devices[0].lastCheckedAt, checked);
  assert.equal(parsed.devices[1].lastCheckedAt, null);
  assert.equal(parsed.devices[0].lastReportedAt, reported);
  assert.equal(parsed.skills[0].lastSeenAt, observed);
  assert.deepEqual(parsed.skills, parseConnectedInventory(before, 3).skills);
  assert.equal(parseConnectedInventory(before, 3).devices[0].lastCheckedAt, null);
  for (const lastCheckedAt of ["invalid", 123, {}, false]) {
    assert.throws(() => parseConnectedInventory({ ...result, devices: [{ ...result.devices[0], lastCheckedAt }] }, 3));
  }
  const data = await loadAccountData(readOnlyApi(async <T>(path: string) => response(path, result) as T, undefined, true, true), identity, false, true, true);
  assert.equal(data.devices[0].lastCheckedAt, checked);
  assert.deepEqual(data.sets, (await load()).sets);
});

test("reconciliation flag is separate, fail-closed and requires every connected prerequisite", () => {
  assert.equal(inventoryReconciliationTestEnabled(configuration), false);
  assert.equal(inventoryReconciliationTestEnabled({ ...configuration, reconciliation: "0" }), false);
  assert.equal(inventoryReconciliationTestEnabled({ ...configuration, reconciliation: "1" }), true);
  for (const reconciliation of ["", "true", "false", "01", " 1"]) {
    assert.throws(() => inventoryReconciliationTestEnabled({ ...configuration, reconciliation }));
  }
  for (const change of [{ enabled: undefined }, { enabled: "0" }, { enabled: "bad" }, { development: false },
    { ready: false }, { integration: "0" }, { publishableKey: "pk_live_fixture" }, { webEnabled: "0" },
    { catalogInstall: "0" }, { preview: "1" }, { legacyInstall: "1" }, { hostname: "omgskills.com" }, { protocol: "https:" }]) {
    assert.throws(() => inventoryReconciliationTestEnabled({ ...configuration, reconciliation: "1", ...change }));
  }
  assert.equal(inventoryReconciliationServerEnabled("serve", environment), true);
  assert.equal(inventoryReconciliationServerEnabled("build", {}), false);
  for (const change of [{ NODE_ENV: "production" }, { PORTAL_TEST_ENVIRONMENT_VERIFIED: "0" },
    { VITE_NEWMAC_CONNECTED_INVENTORY_TEST: "0" }, { PORTAL_TEST_API_ORIGIN: "https://omgskills.com" }]) {
    assert.throws(() => inventoryReconciliationServerEnabled("serve", { ...environment, ...change }));
    assert.throws(() => connectedInventoryServerEnabled("serve", { ...environment, ...change }));
  }
  assert.throws(() => inventoryReconciliationServerEnabled("build", environment));
});

test("browser runtime refuses reconciliation in production or without connected mode", async () => {
  const run = async (env: Record<string, unknown>) => {
    const result = await build({ entryPoints: [fileURLToPath(new URL("../src/connected-inventory-runtime.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "cjs", define: { "import.meta.env": JSON.stringify(env) } });
    const module = { exports: {} as { connectedInventoryTest: boolean; inventoryReconciliationTest: boolean } };
    new Function("location", "module", "exports", result.outputFiles[0].text)({ hostname: "127.0.0.1", protocol: "http:" }, module, module.exports);
    return module.exports;
  };
  const env = { ...environment, DEV: true, VITE_PORTAL_INTEGRATION_READY: true };
  assert.equal((await run(env)).inventoryReconciliationTest, true);
  assert.equal((await run({ ...env, VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST: undefined })).inventoryReconciliationTest, false);
  for (const change of [{ DEV: false }, { VITE_NEWMAC_CONNECTED_INVENTORY_TEST: "0" }, { VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST: "bad" }]) {
    await assert.rejects(run({ ...env, ...change }));
  }
});

test("actual Vite proxy permits only the flagged exact v3 GET without starting a server", () => {
  const overrides: Record<string, string | undefined> = { ...environment, NODE_ENV: "development",
    VITE_NEWMAC_WEB_INSTALL_TEST: "0", VITE_NEWMAC_F1: "0", VITE_NEWMAC_SETUP_TEST: "0", VITE_PORTAL_PREVIEW: "0" };
  const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    for (const flag of ["", "true", "01"]) {
      process.env.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST = flag;
      assert.throws(() => (viteConfig as Function)({ command: "serve", mode: "test" }));
    }
    process.env.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST = "1";
    assert.throws(() => (viteConfig as Function)({ command: "build", mode: "test" }));
    for (const flag of [undefined, "0", "1"]) {
      if (flag === undefined) delete process.env.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST;
      else process.env.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST = flag;
      const config = (viteConfig as Function)({ command: "serve", mode: "test" });
      assert.equal(config.server.proxy["/api/portal"].target, environment.PORTAL_TEST_API_ORIGIN);
      const plugin = config.plugins.find((item: { name?: string }) => item.name === "isolated-portal-access");
      let middleware!: Function;
      plugin.configureServer({ middlewares: { use(fn: Function) { middleware = fn; } } });
      for (const [path, method] of [[v3Path, "GET"], [v3Path, "POST"], [v3Path + "&version=3", "GET"],
        [v3Path + "&other=1", "GET"], ["/api/portal/synced-skills?version=03", "GET"]]) {
        const res = { statusCode: 200, setHeader() {}, end() {} };
        let forwarded = false;
        middleware({ url: path, method }, res, () => { forwarded = true; });
        const permitted = flag === "1" && path === v3Path && method === "GET";
        assert.equal(forwarded, permitted, `actual Vite proxy: flag=${flag}, ${method} ${path}`);
        assert.equal(res.statusCode, permitted ? 200 : 405);
      }
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("only the exact opted-in v3 GET reaches either account transport", async () => {
  assert.equal(isIntegrationRead(v3Path, "GET", true), false);
  assert.equal(isIntegrationRead(v3Path, "GET", false, true), false);
  assert.equal(isIntegrationRequest(v3Path, "GET", true, true), true);
  assert.equal(isIntegrationBody(v3Path, "GET", undefined, true, true), true);
  assert.equal(isIntegrationBody(v3Path, "GET", {}, true, true), false);
  await assert.rejects(readOnlyApi(api, undefined, true)(v3Path));
  await assert.rejects(managementApi(api, true)(v3Path));
  assert.equal((await readOnlyApi(api, undefined, true, true)<ReturnType<typeof inventory>>(v3Path)).inventoryVersion, 3);
  assert.equal((await managementApi(api, true, true)<ReturnType<typeof inventory>>(v3Path)).inventoryVersion, 3);
  for (const path of [v3Path + "&version=3", v3Path + "&other=1", "/api/portal/synced-skills?version=03",
    "/api/portal/synced-skills?%76ersion=3", "/api/portal/synced-skills/?version=3", "/api/portal/devices?version=3"]) {
    assert.equal(isIntegrationRequest(path, "GET", true, true), false);
    await assert.rejects(readOnlyApi(api, undefined, true, true)(path));
    await assert.rejects(managementApi(api, true, true)(path));
  }
  for (const method of ["POST", "PATCH", "DELETE"]) {
    assert.equal(isIntegrationRequest(v3Path, method, true, true), false);
    await assert.rejects(managementApi(api, true, true)(v3Path, { method }));
  }
  await assert.rejects(readOnlyApi(api, undefined, true, true)(v3Path, { body: "{}" }));
  await assert.rejects(managementApi(api, true, true)(v3Path, { body: "{}" }));
  assert.equal(isIntegrationRead("/api/portal/synced-skills"), true);
  assert.equal(isIntegrationRead("/api/portal/synced-skills?version=2", "GET", true), true);
});

test("v3 retains missing rows, physical IDs, unknown Macs, timestamps and Set membership", async () => {
  const data = await load();
  assert.equal(data.inventoryVersion, 3);
  const groups = groupSyncedSkills(data.skills);
  assert.equal(groups.length, 3);
  const missing = groups.find(skill => skill.id === "missing-id")!;
  assert.equal(missing.isCurrent, false);
  assert.equal(missing.lastSeenAt, observed);
  assert.equal(missing.lastReportedAt, reported);
  assert.equal(isMember(data.sets[0], missing), true);
  assert.deepEqual(data.sets[0].membershipSkillIds, ["missing-id"]);
  assert.deepEqual(missing.allSkillIds, ["missing-id"]);
  assert.match(inventorySummary(missing)!.report, /Not found on last scan.*Last seen/);
  assert.ok(inventorySummary(missing)!.report.includes(new Date(observed).toLocaleString()));
  assert.match(inventorySummary(missing)!.latestReport!, /Latest scan incomplete/);
  assert.ok(inventorySummary(missing)!.latestReport!.includes(new Date(reported).toLocaleString()));
  assert.match(inventorySummary(groups.find(skill => skill.id === "other-mac")!)!.report, /Seen on last scan \(revoked\)/);
  assert.match(inventorySummary(groups.find(skill => skill.id === "legacy")!)!.report, /coverage unknown/);
  assert.match(inventorySummary(groups.find(skill => skill.id === "legacy")!)!.location, /Unknown Mac/);
  const item = { id: "retained-item", kind: "synced" as const, syncedSkillId: "missing-id", name: "Saved snapshot", description: "Preserved note", githubUrl: null };
  const saved = setSkillDisplays({ ...data.sets[0], items: [item] }, skillDisplays(data, catalog).mine)[0];
  assert.equal(saved.installed?.isCurrent, false);
  assert.equal(saved.setItemId, item.id);
  assert.equal(saved.name, "Saved snapshot");
});

test("current rows use latest single coverage, incomplete/unavailable roots never invent absence", async () => {
  for (const coverage of [incomplete, complete.map(root => root.source === "codex" ? { ...root, state: "unavailable" as const, reason: "missing" as const } : root), null]) {
    const value = inventory();
    value.skills[0].isCurrent = true;
    value.devices[0].scanCoverage = coverage;
    const skill = groupSyncedSkills((await load(value)).skills).find(skill => skill.id === "missing-id")!;
    assert.equal(skill.isCurrent, true);
    assert.match(inventorySummary(skill)!.report, coverage ? /Last known - scan incomplete/ : /coverage unknown/);
    assert.doesNotMatch(inventorySummary(skill)!.report, /Not found/);
    assert.equal(inventoryCoverageSummary(coverage), coverage ? "Scan incomplete" : "Scan coverage unknown");
  }
  assert.equal(inventoryCoverageSummary(complete), "Scan coverage complete");
  const noReport = inventory();
  noReport.devices[0].lastReportedAt = null as unknown as string;
  noReport.devices[0].scanCoverage = null;
  assert.match(inventorySummary(groupSyncedSkills((await load(noReport)).skills)[0])!.latestReport!, /No report time/);
  assert.deepEqual(parseConnectedInventory({ inventoryVersion: 3, skills: [], devices: [] }, 3), { skills: [], devices: [] });
});

test("complete device coverage cannot make an older positive observation current in the latest report", async () => {
  const value = inventory();
  value.devices[0].scanCoverage = complete;
  value.skills[0].isCurrent = true;
  const stale = groupSyncedSkills((await load(value)).skills).find(skill => skill.id === "missing-id")!;
  assert.equal(stale.isCurrent, true, "The UI must not mutate retained server evidence");
  assert.equal(stale.lastSeenAt, observed);
  assert.match(inventorySummary(stale)!.report, /Last known - not observed in latest report/);
  assert.doesNotMatch(inventorySummary(stale)!.report, /Seen on last scan|Not found/);
  value.skills[0].lastSeenAt = reported;
  const fresh = groupSyncedSkills((await load(value)).skills).find(skill => skill.id === "missing-id")!;
  assert.match(inventorySummary(fresh)!.report, /Seen on last scan/);
  value.skills[0].isCurrent = false;
  const missing = groupSyncedSkills((await load(value)).skills).find(skill => skill.id === "missing-id")!;
  assert.match(inventorySummary(missing)!.report, /Not found on last scan/);
});

test("v3 coverage and isCurrent are strictly validated without automatic protocol detection", () => {
  const valid = inventory();
  const badCoverage: unknown[] = [undefined, {}, [], complete.slice(1), [complete[0], complete[0], complete[2]],
    ["bad", ...complete.slice(1)], complete.map(root => ({ ...root, state: "unknown" })),
    complete.map(root => ({ ...root, source: "other" })), complete.map(root => ({ ...root, reason: "missing" })),
    incomplete.map(root => root.state === "incomplete" ? { ...root, reason: "unreadable" } : root),
    incomplete.map(({ reason: _, ...root }) => root),
    complete.map(root => root.source === "codex" ? { ...root, state: "unavailable" } : root),
    incomplete.map(root => root.state === "incomplete" ? { ...root, reason: undefined } : root),
    incomplete.map(root => root.state === "incomplete" ? { ...root, reason: null } : root),
    incomplete.map(root => ({ ...root, localPath: "/private/test" }))];
  for (const scanCoverage of badCoverage) assert.throws(() => parseConnectedInventory({ ...valid,
    devices: [{ ...valid.devices[0], scanCoverage }, valid.devices[1]] }, 3));
  for (const isCurrent of [undefined, null, 0, "false"]) assert.throws(() => parseConnectedInventory({ ...valid,
    skills: [{ ...valid.skills[0], isCurrent }] }, 3));
  assert.throws(() => parseConnectedInventory(valid));
  assert.throws(() => parseConnectedInventory({ ...valid, inventoryVersion: 2 }, 3));
  assert.throws(() => parseConnectedInventory({ ...valid, devices: [{ ...valid.devices[0], lastReportedAt: null }] }, 3));
});

test("incomplete and unavailable roots require their B1 reason, never an omitted reason", () => {
  for (const state of ["incomplete", "unavailable"]) {
    const value = inventory();
    const scanCoverage = complete.map(root => root.source === "codex" ? { source: root.source, state } : root);
    assert.throws(() => parseConnectedInventory({ ...value, devices: [{ ...value.devices[0], scanCoverage }] }, 3));
  }
});

test("rendered My skills and Set rows retain missing history separately from latest incomplete report", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { UnifiedApp: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }) } });
    const data = await load();
    data.skills[1].lastSeenAt = observed;
    const item = { id: "retained-item", kind: "synced" as const, syncedSkillId: "missing-id", name: "Saved snapshot", description: "Unchanged snapshot", githubUrl: null };
    data.sets[0].items = [item];
    const noOp = () => {};
    const render = (nav = initialNavigation, management?: UnifiedManagement) => renderToStaticMarkup(createElement(module.exports.UnifiedApp, { data, catalog, nav, management,
      signedIn: true, readOnlyAccount: true, state: "ready", navigate: noOp, onSession: noOp, onFavorite: noOp,
      onCreateSet: noOp, onMembership: noOp, onVisibility: noOp, retry: noOp }));
    const mine = render();
    assert.equal([...mine.matchAll(/aria-label="Open Removal fixture"/g)].length, 1);
    // Scan history stays out of the rows; the skill panel shows it behind "Show history".
    assert.doesNotMatch(mine, /Not found on last scan|Last seen|Latest scan incomplete|not observed in latest report|Unknown Mac/);
    const set = render({ ...initialNavigation, view: "set", id: "saved-set" });
    assert.equal([...set.matchAll(/aria-label="Open Removal fixture"/g)].length, 1);
    assert.doesNotMatch(set, /Not found on last scan/);
    const management: UnifiedManagement = { busy: false, blocked: true, notice: "", create: noOp, add: noOp,
      favorite: noOp, rename: noOp, access: noOp, visibility: noOp, remove: noOp, reorder: noOp,
      moderate: noOp, copyLink: noOp, dialog: () => null,
      detail: { set: data.sets[0], state: "ready", error: "", retry: noOp } };
    const managedSet = render({ ...initialNavigation, view: "set", id: "saved-set" }, management);
    assert.equal([...managedSet.matchAll(/aria-label="Open Saved snapshot"/g)].length, 1);
    assert.doesNotMatch(managedSet, /Not found on last scan|Latest scan incomplete/);
    // The Mac install link appears only when the gate supplies one and the Set is not blocked.
    const setNav = { ...initialNavigation, view: "set" as const, id: "saved-set" };
    const appLink = "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fowner%2Fsets%2Fsaved-set";
    assert.match(render(setNav, { ...management, blocked: false, installLink: () => appLink }),
      /<a class="ua-pill ua-set-action" href="omgskills:\/\/group\?url=https%3A%2F%2Fomgskills\.com%2Fu%2Fowner%2Fsets%2Fsaved-set"[^>]*>.*?Install on Mac/);
    assert.doesNotMatch(render(setNav, { ...management, blocked: false, installLink: () => null }), /Install on Mac/);
    assert.doesNotMatch(render(setNav, { ...management, installLink: () => appLink }), /Install on Mac/);
    const selected = render({ ...initialNavigation, selected: "synced:missing-id" });
    assert.match(selected, /aria-label="Open Removal fixture" aria-expanded="true"/);
    const existingLink = render({ ...initialNavigation, selected: "synced:other-mac" });
    assert.match(existingLink, /aria-label="Open Removal fixture" aria-expanded="true"/);
    assert.doesNotMatch(mine, /Uninstalled|Currently live/);
    assert.deepEqual(data.sets[0].items, [item]);

    data.skills = [
      { ...data.skills[0], deviceId: null, source: "Codex", skillMdSha: "a".repeat(64) },
      { ...data.skills[1], catalogSkillId: null, identityStatus: "localOnly", source: "codex", skillMdSha: "a".repeat(64) },
      { ...data.skills[0], id: "claude-copy", source: "Claude Code", skillMdSha: "a".repeat(64) },
    ];
    const beforeGrouping = structuredClone(data);
    const histories = data.skills.map(inventorySummary);
    const filtered = render({ ...initialNavigation, source: "codex" });
    assert.equal([...filtered.matchAll(/aria-label="Open Removal fixture"/g)].length, 1);
    assert.equal([...filtered.matchAll(/<option[^>]*>Codex<\/option>/g)].length, 1);
    assert.equal([...filtered.matchAll(/<option[^>]*>Claude<\/option>/g)].length, 1);
    assert.doesNotMatch(filtered, /<option[^>]*>(?:codex|Claude Code)<\/option>/);
    assert.match(filtered, /aria-label="Observed in 2 agents"/);
    const grouped = skillDisplays(data, catalog).mine;
    assert.equal(grouped.length, 1);
    assert.equal(isMember(data.sets[0], grouped[0].installed!), true);
    const saved = setSkillDisplays(data.sets[0], grouped)[0];
    assert.deepEqual(saved.installed?.allSkillIds, ["missing-id"]);
    assert.equal(saved.installed?.sourceSkills[0], data.skills[0]);
    assert.match(render({ ...setNav, source: "codex" }, management), /aria-label="Open Saved snapshot"/);
    assert.deepEqual(data.skills.map(inventorySummary), histories);
    assert.deepEqual(data, beforeGrouping);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("explicit Set saves refresh with v3 while keeping retained physical membership unchanged", async () => {
  const writes: unknown[] = [], reads: string[] = [];
  const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return { groupId: "saved-set", name: "Renamed Set", description: "", visibility: "private" } as T;
    }
    reads.push(path);
    return response(path) as T;
  };
  const session = createAccountSession({ api: managementApi(transport, true, true), identity, cacheKey: "v3-save",
    connectedInventory: true, inventoryReconciliation: true, changed() {} });
  try {
    await session.refresh();
    const before = session.getSnapshot().data!;
    await session.saveSet({ kind: "update", id: "saved-set", changes: { name: "Renamed Set", description: "", visibility: "private" } });
    assert.equal(reads.filter(path => path === v3Path).length, 2);
    assert.deepEqual(session.getSnapshot().data!.skills, before.skills);
    assert.deepEqual(session.getSnapshot().data!.sets[0].membershipSkillIds, ["missing-id"]);
    assert.deepEqual(writes, [{ path: "/api/portal/groups/saved-set", body: { name: "Renamed Set", description: "", visibility: "private" } }]);
  } finally { session.dispose(); }
});

test("v3 refresh restores the same row and Set link, malformed/offline responses retain last loaded data", async () => {
  let result: unknown = inventory();
  let offline = false;
  const calls: string[] = [];
  const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
    calls.push(path); assert.equal(init?.method ?? "GET", "GET");
    if (offline) throw new Error("Offline");
    return response(path, result) as T;
  };
  let storageAccesses = 0;
  const session = createAccountSession({ api: managementApi(transport, true, true), identity, cacheKey: "v3",
    connectedInventory: true, inventoryReconciliation: true, changed() {},
    storage: { getItem() { storageAccesses++; return null; }, setItem() { storageAccesses++; }, removeItem() { storageAccesses++; } } });
  try {
    await session.refresh();
    const before = session.getSnapshot().data!;
    const restored = inventory(); restored.skills[0].isCurrent = true; restored.skills[0].lastSeenAt = reported; restored.devices[0].scanCoverage = complete;
    result = restored;
    await session.refresh();
    const after = session.getSnapshot().data!;
    assert.deepEqual(after.skills.map(skill => skill.id), before.skills.map(skill => skill.id));
    assert.deepEqual(after.sets, before.sets);
    assert.equal(after.skills[0].isCurrent, true);
    assert.match(inventorySummary(groupSyncedSkills(after.skills).find(skill => skill.id === "missing-id")!)!.report, /Seen on last scan/);
    result = { ...restored, inventoryVersion: 2 };
    await session.refresh();
    assert.equal(session.getSnapshot().data, after);
    assert.match(session.getSnapshot().error, /last loaded/);
    offline = true; await session.refresh();
    assert.equal(session.getSnapshot().data, after);
    assert.equal(calls.filter(path => path === v3Path).length, 4);
    assert.ok(!calls.some(path => path.includes("version=2") || path === "/api/portal/synced-skills"));
    assert.equal(storageAccesses, 0);
  } finally { session.dispose(); }
});

test("disposed, switched and unauthorized v3 accounts cannot accept late retained inventory", async () => {
  const releases: (() => void)[] = [], signals: AbortSignal[] = [];
  const delayed: PortalApi = <T>(path: string, init?: RequestInit) => new Promise<T>(resolve => {
    signals.push(init!.signal!); releases.push(() => resolve(response(path) as T));
  });
  const session = (api: PortalApi, name: string) => createAccountSession({ api, identity: { ...identity, name }, cacheKey: name,
    connectedInventory: true, inventoryReconciliation: true, changed() {} });
  const old = session(delayed, "Old"); const pending = old.refresh(); old.dispose();
  const current = session(api, "New"); await current.refresh();
  releases.forEach(release => release()); await pending;
  assert.equal(old.getSnapshot().data, null);
  assert.equal(current.getSnapshot().data?.profile.name, "New");
  assert.ok(signals.every(signal => signal.aborted));
  current.dispose();
  const invalidated = session(delayed, "Invalidated"); const offset = releases.length;
  const late = invalidated.refresh(); invalidated.invalidateAccess();
  releases.slice(offset).forEach(release => release()); await late;
  assert.equal(invalidated.getSnapshot().data, null); invalidated.dispose();
  const unauthorized = session(async () => { throw new PortalApiError("Unauthorized", 401); }, "Denied");
  await unauthorized.refresh();
  assert.equal(unauthorized.getSnapshot().accessDenied, true);
  assert.equal(unauthorized.getSnapshot().data, null); unauthorized.dispose();
});
