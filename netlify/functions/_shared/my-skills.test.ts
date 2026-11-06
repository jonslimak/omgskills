import assert from "node:assert/strict";
import test from "node:test";
import { handleMySkills, MY_SKILLS_LIMIT, type MySkillsDependencies } from "./my-skills.js";

const catalogId = "author/repo:skill";
const user = { id: "user-1", clerkUserId: "clerk", email: "u@example.test", displayName: "U" };
const base = "https://omgskills.com/api/portal/my-skills";

type Row = { catalogSkillId: string; addedAt: Date };

// A tiny in-memory stand-in for my_skill_additions; the handler's SQL and responses are real.
function harness(options: { denied?: boolean; catalogDown?: boolean; rows?: Row[]; limit?: number } = {}) {
  const rows: Row[] = options.rows ?? [];
  const queries: { sql: string; values?: unknown[] }[] = [];
  let catalogLoads = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    assert.equal(values[0], user.id);
    if (sql.includes("INSERT INTO my_skill_additions")) {
      const limit = options.limit ?? (values[2] as number);
      if (rows.some((r) => r.catalogSkillId === values[1]) || rows.length >= limit) return { rows: [] };
      rows.push({ catalogSkillId: values[1] as string, addedAt: new Date(Date.UTC(2026, 10, 6, 0, rows.length)) });
      return { rows: [{ catalog_skill_id: values[1] }] };
    }
    if (sql.includes("SELECT 1 FROM my_skill_additions")) {
      return { rows: rows.filter((r) => r.catalogSkillId === values[1]).map(() => ({})) };
    }
    if (sql.includes("DELETE FROM my_skill_additions")) {
      const index = rows.findIndex((r) => r.catalogSkillId === values[1]);
      if (index < 0) return { rows: [] };
      rows.splice(index, 1);
      return { rows: [{ catalog_skill_id: values[1] }] };
    }
    if (sql.includes("FROM my_skill_additions")) {
      assert.match(sql, /ORDER BY added_at DESC/);
      return { rows: [...rows].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime()) };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const deps: Partial<MySkillsDependencies> = {
    getPgPool: () => ({ query }) as unknown as ReturnType<MySkillsDependencies["getPgPool"]>,
    requirePortalUser: async () => {
      if (options.denied) throw new Response("Unauthorized", { status: 401 });
      return user;
    },
    loadPublishedSkills: loader,
  };
  return { deps, rows, queries, catalogLoads: () => catalogLoads };
  async function loader() {
      catalogLoads++;
      if (options.catalogDown) throw new Error("Published catalog unavailable");
      return [
        { id: catalogId },
        { id: "other/repo:two" },
        { id: "new/repo:b", name: "B", description: "Does b", author_handle: "newauthor", github_url: "https://github.com/new/repo" },
        { id: "old/repo:a", name: "A", githubUrl: "https://github.com/old/repo" },
      ];
  }
}

const post = (body: unknown) => new Request(base, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const del = (id: string) => new Request(`${base}?catalogSkillId=${encodeURIComponent(id)}`, { method: "DELETE" });

const listRows = () => [
  { catalogSkillId: "old/repo:a", addedAt: new Date("2026-11-01T00:00:00Z") },
  { catalogSkillId: "gone/repo:c", addedAt: new Date("2026-11-03T00:00:00Z") },
  { catalogSkillId: "new/repo:b", addedAt: new Date("2026-11-05T00:00:00Z") },
];

test("GET lists My skills newest first without waiting for the catalog", async () => {
  const h = harness({ rows: listRows(), catalogDown: true });
  const response = await handleMySkills(new Request(base), h.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { skills: [
    { catalogSkillId: "new/repo:b", addedAt: "2026-11-05T00:00:00.000Z" },
    { catalogSkillId: "gone/repo:c", addedAt: "2026-11-03T00:00:00.000Z" },
    { catalogSkillId: "old/repo:a", addedAt: "2026-11-01T00:00:00.000Z" },
  ] });
  assert.equal(h.catalogLoads(), 0);
});

test("POST adds a catalog skill, and a repeat add is a no-op", async () => {
  const h = harness();
  const first = await handleMySkills(post({ catalogSkillId: ` ${catalogId} ` }), h.deps);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { catalogSkillId: catalogId, added: true });
  const again = await handleMySkills(post({ catalogSkillId: catalogId }), h.deps);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { catalogSkillId: catalogId, added: false });
  assert.equal(h.rows.length, 1);
  const insert = h.queries.find((q) => q.sql.includes("INSERT"))!;
  assert.match(insert.sql, /ON CONFLICT \(user_id, catalog_skill_id\) DO NOTHING/);
  assert.deepEqual(insert.values, [user.id, catalogId, MY_SKILLS_LIMIT]);
});

test("POST rejects ids missing from the published catalog", async () => {
  const h = harness();
  const response = await handleMySkills(post({ catalogSkillId: "nobody/repo:none" }), h.deps);
  assert.equal(response.status, 404);
  assert.equal(h.queries.length, 0);
});

test("POST returns 503 when the catalog is unavailable", async () => {
  const h = harness({ catalogDown: true });
  const response = await handleMySkills(post({ catalogSkillId: catalogId }), h.deps);
  assert.equal(response.status, 503);
  assert.equal(h.queries.length, 0);
});

test("POST returns 409 when My skills is full, but repeats stay idempotent", async () => {
  const h = harness({ limit: 1, rows: [{ catalogSkillId: catalogId, addedAt: new Date() }] });
  const full = await handleMySkills(post({ catalogSkillId: "other/repo:two" }), h.deps);
  assert.equal(full.status, 409);
  assert.equal(h.rows.length, 1);
  const repeat = await handleMySkills(post({ catalogSkillId: catalogId }), h.deps);
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), { catalogSkillId: catalogId, added: false });
});

test("DELETE removes by the id in the query and is idempotent", async () => {
  const h = harness({ rows: [{ catalogSkillId: catalogId, addedAt: new Date() }] });
  const first = await handleMySkills(del(catalogId), h.deps);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { removed: true });
  assert.equal(h.rows.length, 0);
  const again = await handleMySkills(del(catalogId), h.deps);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { removed: false });
});

test("requests without a portal user fail with the auth status", async () => {
  const h = harness({ denied: true });
  for (const req of [new Request(base), post({ catalogSkillId: catalogId }), del(catalogId)]) {
    const response = await handleMySkills(req, h.deps);
    assert.equal(response.status, 401);
  }
  assert.equal(h.queries.length, 0);
  assert.equal(h.catalogLoads(), 0);
});

test("bad ids and bodies are rejected with 400", async () => {
  const h = harness();
  const bad = [
    post({}),
    post({ catalogSkillId: "   " }),
    post({ catalogSkillId: 42 }),
    post({ catalogSkillId: "x".repeat(501) }),
    new Request(base, { method: "POST", body: "not json" }),
    new Request(base, { method: "DELETE" }),
    new Request(`${base}?catalogSkillId=%20`, { method: "DELETE" }),
    new Request(`${base}?catalogSkillId=${"x".repeat(501)}`, { method: "DELETE" }),
  ];
  for (const req of bad) {
    const response = await handleMySkills(req, h.deps);
    assert.equal(response.status, 400, `${req.method} ${req.url}`);
  }
  assert.equal(h.queries.length, 0);
});

test("wrong methods return 405", async () => {
  const h = harness();
  for (const req of [
    new Request(base, { method: "PUT" }),
    new Request(base, { method: "PATCH" }),
  ]) {
    const response = await handleMySkills(req, h.deps);
    assert.equal(response.status, 405, `${req.method} ${req.url}`);
  }
  assert.equal(h.queries.length, 0);
});

test("OPTIONS answers the CORS preflight", async () => {
  const response = await handleMySkills(new Request(base, { method: "OPTIONS" }), harness().deps);
  assert.ok(response.status < 300);
});

test("a paired Mac reads and removes with its credential, but can't add", async () => {
  const scopes: string[] = [];
  const h = harness({ denied: true, rows: [{ catalogSkillId: catalogId, addedAt: new Date("2026-11-06T00:00:00Z") }] });
  h.deps.requireDevice = async (_req, scope) => { scopes.push(scope); return { id: user.id }; };
  const device = { authorization: `Bearer device_${"a".repeat(43)}` };
  const list = await handleMySkills(new Request(base, { headers: device }), h.deps);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { skills: [{ catalogSkillId: catalogId, addedAt: "2026-11-06T00:00:00.000Z" }] });
  const removed = await handleMySkills(new Request(`${base}?catalogSkillId=${encodeURIComponent(catalogId)}`,
    { method: "DELETE", headers: device }), h.deps);
  assert.deepEqual(await removed.json(), { removed: true });
  const add = await handleMySkills(new Request(base, { method: "POST", headers: { ...device, "content-type": "application/json" },
    body: JSON.stringify({ catalogSkillId: catalogId }) }), h.deps);
  assert.equal(add.status, 401);
  assert.deepEqual(scopes, ["sync:write", "content:write"]);
});
