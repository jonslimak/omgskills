import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentKind, skillDisplays } from "../src/app/unified/model";
import { entryNavigation } from "../src/integration/unified/entry-navigation";
import { addCatalogMembership } from "../src/integration/membership-data";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { makeFixtures } from "../src/preview/fixtures";

test("agent badges recognize actual source casing without changing stored names", () => {
  for (const name of ["claude", "Claude", "CLAUDE CODE"]) assert.equal(agentKind(name), "claude");
  for (const name of ["Codex", "codex"]) assert.equal(agentKind(name), "codex");
  assert.equal(agentKind("Cursor"), "other");
});
test("both production bases preserve legacy set links and account destinations", () => {
  for (const base of ["/", "/app/", "/app/integration/unified/"]) {
    assert.equal(entryNavigation(`${base}groups/abc-123`, "", base).id, "abc-123");
    assert.equal(entryNavigation(`${base}groups/abc-123`, "", base).view, "set");
    assert.equal(entryNavigation(`${base}home`, "", base).view, "profile");
    assert.equal(entryNavigation(base, "?view=devices", base).view, "devices");
  }
});
test("production unified shell stays explicitly opt-in and preserves connect and review", () => {
  const bootstrap = readFileSync(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
  assert.match(bootstrap, /!import\.meta\.env\.DEV &&\s+import\.meta\.env\.VITE_PORTAL_UNIFIED_ENABLED === "1"/);
  assert.ok(bootstrap.indexOf('import("./review/main")') < bootstrap.indexOf('import("./unified-main")'));
  assert.match(bootstrap, /portalSurface\(location.pathname, isFeatureEnabled\(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED\)\) === "dashboard"/);
  const entry = readFileSync(new URL("../src/unified-main.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(entry, /fixtures|preview\/|INTEGRATION_READY/);
  assert.match(entry, /ClerkProvider/);
});

function catalogFixture(options: { present?: boolean; missingIdentity?: boolean; role?: string; hidden?: boolean; favorites?: boolean; badResponse?: boolean; conflict?: boolean } = {}) {
  const calls: { path: string; method: string; body: any }[] = [];
  let present = options.present ?? false;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (method === "GET") return {
      group: { id: "set", name: "Set", visibility: options.favorites ? "public" : "private", isFavorites: options.favorites, disabledAt: options.hidden ? "2026-10-06" : null },
      accessRole: options.role ?? "owner",
      items: present ? [{ id: "item", ...(options.missingIdentity ? {} : { catalogSkillId: "owner/repo:skill" }), kind: "catalog", name: "Skill", description: "", position: 0, githubUrl: null }] : [],
    } as T;
    if (path === "/api/portal/groups") return { groupId: "set" } as T;
    present = true;
    if (options.conflict) throw new PortalApiError("Already saved", 409);
    return (options.badResponse ? {} : { itemId: "item" }) as T;
  };
  return { api, calls };
}
const command = { kind: "catalog" as const, catalogId: "owner/repo:skill", favorite: false, id: "set" };
const signal = () => new AbortController().signal;
test("catalog save uses exact ID, performs no installation, and deduplicates from fresh data", async () => {
  const f = catalogFixture();
  assert.equal((await addCatalogMembership(f.api, [], command, signal())).added, 1);
  assert.deepEqual(f.calls[1].body, { kind: "catalog", catalogSkillId: command.catalogId });
  assert.equal((await addCatalogMembership(f.api, [], command, signal())).unchanged, 1);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});
test("catalog saves reject readers, hidden sets, and ordinary saves to protected Favorites", async () => {
  for (const options of [{ role: "invited" }, { role: "public" }, { hidden: true }, { favorites: true }]) {
    const f = catalogFixture(options);
    await assert.rejects(addCatalogMembership(f.api, [], command, signal()));
    assert.ok(f.calls.every(call => call.method === "GET"));
  }
});
test("current responses without catalog identity block repeat saves instead of duplicating", async () => {
  const f = catalogFixture({ missingIdentity: true });
  assert.equal((await addCatalogMembership(f.api, [], command, signal())).added, 1);
  await assert.rejects(addCatalogMembership(f.api, [], command, signal()), /identity is unavailable/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});
test("catalog Favorites require the existing synced-skill-created container; no unsupported create request", async () => {
  const f = catalogFixture({ favorites: true });
  await assert.rejects(addCatalogMembership(f.api, [], { ...command, favorite: true }, signal()), /Favorite an installed skill first/);
  assert.equal(f.calls.length, 0);
  const set = { ...makeFixtures().sets[0], id: "set", isFavorites: true, role: "owner" as const };
  assert.equal((await addCatalogMembership(f.api, [set], { ...command, favorite: true }, signal())).added, 1);
  assert.ok(f.calls.every(call => call.path !== "/api/portal/groups"));
});
test("catalog duplicate conflicts require a fresh matching item, malformed responses are not success", async () => {
  const f = catalogFixture({ conflict: true });
  assert.equal((await addCatalogMembership(f.api, [], command, signal())).unchanged, 1);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  await assert.rejects(addCatalogMembership(catalogFixture({ badResponse: true }).api, [], command, signal()), /Unexpected add response/);
});
test("aborted catalog save starts no requests", async () => {
  const f = catalogFixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(addCatalogMembership(f.api, [], command, controller.signal), { name: "AbortError" });
  assert.equal(f.calls.length, 0);
});
test("discovery associates installs by exact catalog identity", () => {
  const data = makeFixtures();
  data.skills[0].catalogSkillId = "owner/repo:skill";
  const catalog = { skills: [{ id: "owner/repo:skill", name: "Skill", description: "", githubUrl: "https://github.com/owner/repo", author: "owner", tags: [] }], collections: [], creators: [], categories: [], trendingIds: [] };
  assert.ok(skillDisplays(data, catalog).library[0].installed);
});
