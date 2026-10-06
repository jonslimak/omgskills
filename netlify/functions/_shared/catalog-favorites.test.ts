import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { createGroup } from "../portal-groups.mjs";
import { addGroupItemWithClient } from "./group-items.js";
import { PublicReleaseResolutionError } from "./public-releases.js";

const catalogId = "author/repo:skill";
const user = { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: "Owner" };
const skill = { id: "synced", name: "Skill", description: "", identityStatus: "localOnly", catalogSkillId: null, skillMdSha: "a".repeat(40) };
const request = (body: unknown) => new Request("https://omgskills.com/api/portal/groups", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const status = (code: number) => (error: unknown) => error instanceof Response && error.status === code;
const favorites = { name: "Favorite Skills", isFavorites: true, catalogSkillId: catalogId };

// Only dependencies are simulated: exercise real parsing, transaction control and responses.
function creation(options: { failItem?: boolean; unavailable?: boolean; collision?: boolean; denied?: boolean; foreignSkill?: boolean } = {}) {
  const queries: { sql: string; values?: unknown[] }[] = [];
  const items: Parameters<typeof addGroupItemWithClient>[2][] = [];
  let released = false, resolutions = 0;
  const query = async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    if (sql.includes("FROM synced_skills")) {
      assert.equal(values?.[0], user.id);
      return { rows: (values?.[1] as string[]).length && !options.foreignSkill ? [skill] : [] };
    }
    if (sql.includes("INSERT INTO skill_groups")) {
      if (options.collision) throw Object.assign(new Error("unique slug"), { code: "23505" });
      return { rows: [{ id: "group" }] };
    }
    return { rows: [] };
  };
  const client = { query, release: () => { released = true; } } as unknown as PoolClient;
  const deps = {
    getPgPool: () => ({ query, connect: async () => client }) as unknown as Pool,
    requirePortalUser: async () => { if (options.denied) throw new Response("Unauthorized", { status: 401 }); return user; },
    prepareSyncedGroupPublication: async () => ({ kind: "metadata_only" as const, reason: "local" }),
    resolveCatalogPublicRelease: async (id: string) => {
      assert.equal(id, catalogId); resolutions++;
      if (options.unavailable) throw new PublicReleaseResolutionError("catalog_unavailable", "Catalog skill is unavailable");
      return { source: { kind: "catalog" as const, catalogSkillId: id, normalizedRoot: "skills/example" },
        coordinates: { githubOwner: "author", githubRepo: "repo", commitSha: "a".repeat(40), treeSha: "b".repeat(40), skillMdSha: "c".repeat(40), normalizedRoot: "skills/example" },
        createdBy: `catalog:${id}` };
    },
    addGroupItemWithClient: async (...args: Parameters<typeof addGroupItemWithClient>) => {
      assert.equal(args[0], client); assert.equal(args[1], "group");
      assert.equal(queries.at(-1)?.sql.includes("FOR SHARE"), true);
      assert.equal(args[4]?.incrementRevision, false);
      assert.ok(args[3]); items.push(args[2]);
      if (options.failItem) throw new Error("item write failed");
      return { itemId: "item", position: 0 };
    },
  };
  return { deps, queries, items, released: () => released, resolutions: () => resolutions };
}

test("catalog Favorites create the public reserved set and its first item in one transaction", async () => {
  const f = creation();
  const response = await createGroup(request({ ...favorites, visibility: "private", slug: "other" }), f.deps);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { groupId: "group", slug: "favorites" });
  const insert = f.queries.find(q => q.sql.includes("INSERT INTO skill_groups"))!;
  assert.deepEqual(insert.values, [user.id, "Favorite Skills", null, "favorites", "public", true]);
  assert.deepEqual(f.items, [{ kind: "catalog", catalogSkillId: catalogId }]);
  assert.equal(f.resolutions(), 1);
  assert.equal(f.queries.at(-1)?.sql, "COMMIT");
  assert.equal(f.released(), true);
});

test("failed first-item save rolls back the Favorites creation transaction", async () => {
  const f = creation({ failItem: true });
  await assert.rejects(createGroup(request(favorites), f.deps), status(500));
  assert.equal(f.queries.at(-1)?.sql, "ROLLBACK");
  assert.ok(!f.queries.some(q => q.sql === "COMMIT"));
  assert.equal(f.released(), true);
});

test("unavailable catalog skills fail before starting a creation transaction", async () => {
  const f = creation({ unavailable: true });
  await assert.rejects(createGroup(request(favorites), f.deps), PublicReleaseResolutionError);
  assert.ok(!f.queries.some(q => q.sql === "BEGIN"));
  assert.deepEqual(f.items, []);
});

test("concurrent Favorites creation conflict remains a 409 without a second set", async () => {
  const f = creation({ collision: true });
  await assert.rejects(createGroup(request(favorites), f.deps), status(409));
  assert.equal(f.queries.at(-1)?.sql, "ROLLBACK");
  assert.deepEqual(f.items, []);
  assert.equal(f.released(), true);
});

test("catalog creation rejects invalid IDs, empty Favorites, mixed inputs and ordinary sets", async () => {
  for (const body of [null, [], { ...favorites, catalogSkillId: "" }, { ...favorites, catalogSkillId: null },
    { ...favorites, catalogSkillId: [catalogId] }, { ...favorites, catalogSkillId: "x".repeat(501) },
    { name: "Favorite Skills", isFavorites: true }, { ...favorites, syncedSkillIds: ["synced"] },
    { ...favorites, isFavorites: false }]) {
    const f = creation();
    await assert.rejects(createGroup(request(body), f.deps), status(400));
    assert.equal(f.queries.length, 0); assert.equal(f.resolutions(), 0);
  }
});

test("unauthenticated creation never reaches catalog or storage", async () => {
  const f = creation({ denied: true });
  await assert.rejects(createGroup(request(favorites), f.deps), status(401));
  assert.equal(f.queries.length, 0); assert.equal(f.resolutions(), 0);
});

test("existing synced Favorites and empty ordinary-set creation still work", async () => {
  for (const body of [{ name: "Favorites", isFavorites: true, syncedSkillIds: [skill.id] }, { name: "New set" }]) {
    const f = creation();
    assert.equal((await createGroup(request(body), f.deps)).status, 201);
    assert.equal(f.resolutions(), 0);
    assert.equal(f.items.length, "isFavorites" in body ? 1 : 0);
    assert.equal(f.queries.at(-1)?.sql, "COMMIT");
  }
  const f = creation({ foreignSkill: true });
  await assert.rejects(createGroup(request({ name: "Favorites", isFavorites: true, syncedSkillIds: ["foreign"] }), f.deps), status(400));
  assert.ok(!f.queries.some(q => q.sql === "BEGIN"));
});

// Simulate row-lock serialization, not a live database or a disposable server.
function lockedStorage() {
  const rows: { id: string; group: string; catalogId: string }[] = [];
  const tails = new Map<string, Promise<void>>();
  const events: string[] = [];
  async function save(group: string, id: string) {
    let unlock: (() => void) | undefined;
    let locked = false;
    const client = { query: async (sql: string, values: unknown[]) => {
      if (sql.includes("FOR UPDATE")) {
        const previous = tails.get(group) ?? Promise.resolve();
        tails.set(group, new Promise<void>(resolve => { unlock = resolve; }));
        await previous; locked = true; events.push("lock");
        return { rows: [{ revision: 1 }], rowCount: 1 };
      }
      assert.ok(locked, "identity check and insert must happen under the set lock");
      if (sql.includes("SELECT id FROM skill_group_items")) {
        assert.match(sql, /kind = 'catalog' AND catalog_skill_id = \$2/);
        const found = rows.filter(row => row.group === values[0] && row.catalogId === values[1]);
        events.push("check"); return { rows: found, rowCount: found.length };
      }
      if (sql.includes("MAX(position)")) return { rows: [{ next_position: rows.length }] };
      if (sql.includes("INSERT INTO skill_group_items")) {
        const row = { id: String(rows.length + 1), group, catalogId: id };
        rows.push(row); events.push("insert"); return { rows: [row] };
      }
      if (sql.includes("UPDATE skill_groups")) return { rows: [{ revision: 2 }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    } } as unknown as PoolClient;
    try { return await addGroupItemWithClient(client, group, { kind: "catalog", catalogSkillId: id }); }
    finally { unlock?.(); }
  }
  return { rows, events, save };
}

test("simultaneous catalog saves check exact identity under the existing lock", async () => {
  const db = lockedStorage();
  const result = await Promise.allSettled([db.save("one", catalogId), db.save("one", catalogId)]);
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[1].status, "rejected");
  assert.ok(result[1].status === "rejected" && status(409)(result[1].reason));
  assert.equal(db.rows.length, 1);
  assert.deepEqual(db.events, ["lock", "check", "insert", "lock", "check"]);
});

test("different catalog IDs and different sets are not treated as duplicates", async () => {
  const db = lockedStorage();
  await db.save("one", catalogId);
  await db.save("one", "author/repo:other");
  await db.save("two", catalogId);
  assert.equal(db.rows.length, 3);
});
