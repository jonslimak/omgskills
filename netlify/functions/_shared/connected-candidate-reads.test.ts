import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { createConnectedCandidateApi } from "../../../scripts/connected-candidate-api.mjs";
import { candidateDatabase, connectedCandidateOrigin as origin, connectedCandidateSiteId } from "./connected-candidate.js";
import type { PortalGroupItemRow } from "./portal-group-item.js";
import { portalDevices } from "../portal-devices.mjs";
import { portalProfile } from "../portal-profile.mjs";
import { portalGroups } from "../portal-groups.mjs";
import { portalShared } from "../portal-shared.mjs";
import { listUserDevices, revokeOwnedDevice } from "./device-auth.js";

const environment = {
  OMGSKILLS_CONNECTED_CANDIDATE: "1", OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: "connected",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: "postgresql://candidate_test:unit_only@candidate-db.invalid/candidate_test?sslmode=require",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST: "candidate-db.invalid",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: "candidate_test",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER: "candidate_test",
  CLERK_SECRET_KEY: "sk_test_CC2AUnitFixtureNotARealKey",
};
const context = { site: { id: connectedCandidateSiteId }, deploy: { context: "production" } } as Context;
const actors = Object.fromEntries(["alice", "bob", "invited", "stranger"].map(id => [id,
  { id, clerkUserId: `clerk-${id}`, email: `${id}@example.test`, displayName: id }]));
const id = (digit: number) => `${digit.toString().repeat(8)}-${digit.toString().repeat(4)}-4${digit.toString().repeat(3)}-8${digit.toString().repeat(3)}-${digit.toString().repeat(12)}`;
const paths = ["devices", "profile", "groups", "shared", `groups/${id(1)}`];

function request(path: string, actor = "alice", init: RequestInit = {}) {
  return new Request(`${origin}/api/portal/${path}`, {
    ...init, headers: { Authorization: `Bearer ${actor}.payload.signature`, ...init.headers },
  });
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
  response.headers.forEach((_value, key) => assert.equal(key.startsWith("access-control-"), false));
}

// Only SQL results and Clerk identity are faked: handlers and access/list helpers run unchanged.
function fixture(factory = createConnectedCandidateApi) {
  const calls: string[] = [];
  const queries: { text: string; values: unknown[] }[] = [];
  let fault: string | undefined;
  const groups = [
    { id: id(1), ownerUserId: "alice", visibility: "private", isFavorites: true, disabledAt: null },
    { id: id(2), ownerUserId: "bob", visibility: "private", isFavorites: false, disabledAt: null },
    { id: id(3), ownerUserId: "bob", visibility: "restricted", isFavorites: false, disabledAt: null },
    { id: id(4), ownerUserId: "bob", visibility: "public", isFavorites: false, disabledAt: null },
    { id: id(5), ownerUserId: "bob", visibility: "restricted", isFavorites: false, disabledAt: "2026-10-19T00:00:00Z" },
  ].map(group => ({ ...group, name: `Set ${group.id}`, slug: `set-${group.id}`, description: "Saved Set",
    allowedEmails: [{ id: "access-row", email: "invited@example.test" }] }));
  const items: PortalGroupItemRow[] = [
    { id: "physical-item", kind: "synced", syncedSkillId: "physical-skill", catalogSkillId: null,
      itemGithubUrl: null, snapshotName: "Saved skill", snapshotDescription: null, note: "Saved note", position: 0,
      skillName: "Current skill", skillDescription: "Current description", githubUrl: "https://github.com/example/skill", source: "codex" },
    { id: "catalog-item", kind: "catalog", syncedSkillId: null, catalogSkillId: "catalog:example/skill",
      itemGithubUrl: null, snapshotName: "Catalog skill", snapshotDescription: null, note: "Catalog note", position: 1,
      skillName: null, skillDescription: null, githubUrl: null, source: null },
  ];
  const snapshot = JSON.stringify({ groups, items });
  const pool = { async query(text: string, values: unknown[] = []) {
    text = text.replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    if (fault && text.includes(fault)) throw Error("private database password diagnostic");
    if (text.startsWith("SELECT current_database")) {
      calls.push("identity"); return { rows: [{ database: "candidate_test", username: "candidate_test" }] };
    }
    if (text.startsWith("UPDATE users") && text.includes("WHERE clerk_user_id = $1")) {
      calls.push("user");
      const actor = Object.values(actors).find(actor => actor.clerkUserId === values[0]);
      assert.ok(actor); assert.equal(values[1], actor.email); return { rows: [actor] };
    }
    if (text.includes("FROM device_tokens")) {
      assert.match(text, /WHERE user_id = \$1/);
      assert.doesNotMatch(text, /token_hash|credential_hash/);
      assert.ok(values[1] instanceof Date); assert.equal(typeof values[2], "string");
      return { rows: values[0] === "alice" ? ["active", "revoked", "expired", "inactive"].map(status => ({
        id: `alice-${status}`, deviceName: "Alice Mac", status, lastUsedAt: "2026-10-19T12:00:00Z",
        expiresAt: "2027-10-19T12:00:00Z", revokedAt: status === "revoked" ? "2026-10-19T12:00:00Z" : null,
      })) : values[0] === "bob" ? [{ id: "bob-mac", deviceName: "Bob Mac", status: "active" }] : [] };
    }
    if (text.startsWith('SELECT handle AS "handle"')) {
      assert.match(text, /WHERE id = \$1/);
      return { rows: values[0] === "alice" ? [{ handle: "alice", profilePublished: true }] : [] };
    }
    if (text.startsWith("SELECT id FROM skill_groups WHERE owner_user_id = $1")) {
      return { rows: groups.filter(group => group.ownerUserId === values[0]).map(({ id }) => ({ id })) };
    }
    if (text.startsWith("SELECT DISTINCT group_id AS id FROM skill_group_allowed_emails WHERE email = $1")) {
      return { rows: groups.filter(group => group.allowedEmails.some(entry => entry.email === values[0])).map(({ id }) => ({ id })) };
    }
    if (text.includes('AS "ownerUserId"')) {
      const group = groups.find(group => group.id === values[0]);
      return { rows: group ? [{ ...group, invited: group.allowedEmails.some(entry => entry.email === values[1]) }] : [] };
    }
    if (text.includes("WHERE g.id = ANY($1::uuid[])")) {
      const selected = groups.filter(group => (values[0] as string[]).includes(group.id));
      return { rows: selected.map(group => text.includes('AS "ownerDisplayName"')
        ? { id: group.id, name: group.name, description: group.description, slug: group.slug,
          visibility: group.visibility, ownerDisplayName: group.ownerUserId, itemCount: items.length }
        : { id: group.id, name: group.name, description: group.description, slug: group.slug, visibility: group.visibility,
          isFavorites: group.isFavorites, disabledAt: group.disabledAt, itemCount: items.length,
          allowedEmailCount: group.allowedEmails.length, allowedEmails: group.allowedEmails, syncedSkillIds: ["physical-skill"] }) };
    }
    if (text.includes("GROUP BY g.id, owner.display_name, owner.handle")) {
      const group = groups.find(group => group.id === values[0]);
      assert.ok(group); assert.ok(["owner", "invited", "public"].includes(values[1] as string));
      const { ownerUserId, ...summary } = group;
      return { rows: [{ ...summary, ownerDisplayName: ownerUserId, ownerHandle: ownerUserId, itemCount: items.length }] };
    }
    if (text.includes("FROM skill_group_items i")) {
      assert.match(text, /WHERE i.group_id = \$1/);
      assert.ok(["owner", "invited", "public"].includes(values[1] as string));
      return { rows: items };
    }
    assert.fail(`Unexpected read SQL: ${text}`);
  }, async connect() { assert.fail("Account reads must not open mutation transactions"); } } as unknown as Pool;
  const deps = {
    getEnvironment: () => environment,
    getPool: candidateDatabase(connection => {
      calls.push("pool"); assert.equal(connection, environment.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL); return pool;
    }),
    user: {
      async requireAuth(req: Request) {
        calls.push("auth");
        const actor = actors[req.headers.get("authorization")!.split(" ")[1].split(".")[0]];
        if (!actor) throw new Response("Invalid Clerk session token", { status: 401 });
        return { clerkUserId: actor.clerkUserId };
      },
      async loadClerkUser(clerkId: string, key: string) {
        calls.push("clerk"); assert.equal(key, environment.CLERK_SECRET_KEY);
        const actor = Object.values(actors).find(actor => actor.clerkUserId === clerkId)!;
        return { primaryEmailAddressId: "email", firstName: actor.id, lastName: null,
          emailAddresses: [{ id: "email", emailAddress: actor.email, verification: { status: "verified" } }] };
      },
    },
  };
  const api = factory(deps);
  return { calls, queries, deps, api, pool, groups, items,
    failOn: (text: string) => { fault = text; },
    unchanged: () => assert.equal(JSON.stringify({ groups, items }), snapshot),
    async read(path: string, actor = "alice") {
      const response = await api(request(path, actor), context);
      assert.equal(response.status, 200, await response.clone().text()); privateHeaders(response);
      return response.json();
    },
  };
}

async function readJourney(factory = createConnectedCandidateApi) {
  const f = fixture(factory);
  const devices = await f.read("devices");
  assert.deepEqual(devices.devices.map((row: { status: string }) => row.status), ["active", "revoked", "expired", "inactive"]);
  assert.deepEqual(f.calls, ["auth", "clerk", "pool", "identity", "user"]);
  assert.equal((await f.read("devices", "bob")).devices[0].id, "bob-mac");
  assert.deepEqual(await f.read("profile"), { profile: { handle: "alice", profilePublished: true, publicUrl: `${origin}/u/alice` } });
  assert.deepEqual(await f.read("profile", "bob"), { profile: { handle: null, profilePublished: false, publicUrl: null } });
  const owned = (await f.read("groups")).groups;
  assert.equal(owned.length, 1); assert.equal(owned[0].id, id(1)); assert.equal(owned[0].isFavorites, true);
  assert.equal(owned[0].itemCount, 2); assert.deepEqual(owned[0].syncedSkillIds, ["physical-skill"]);
  assert.equal(owned[0].allowedEmails[0].id, "access-row"); assert.equal(owned[0].allowedEmailCount, 1);
  assert.deepEqual((await f.read("groups", "bob")).groups.map((row: { id: string }) => row.id), [id(2), id(3), id(4), id(5)]);
  const shared = (await f.read("shared", "invited")).groups;
  assert.deepEqual(shared.map((row: { id: string }) => row.id), [id(3)]);
  assert.equal(Object.hasOwn(shared[0], "allowedEmails"), false);
  assert.equal(Object.hasOwn(shared[0], "syncedSkillIds"), false);
  for (const path of ["devices", "groups", "shared"]) {
    assert.deepEqual(await f.read(path, "stranger"), { [path === "devices" ? "devices" : "groups"]: [] });
  }
  const owner = await f.read(`groups/${id(1)}`);
  assert.equal(owner.accessRole, "owner"); assert.equal(owner.items[0].id, "physical-item");
  assert.equal(owner.items[0].syncedSkillId, "physical-skill");
  assert.equal(owner.items[1].catalogSkillId, "catalog:example/skill");
  assert.equal(owner.items[1].description, "Catalog note");
  assert.equal(owner.group.allowedEmails[0].id, "access-row");
  const appLink = new URL(owner.group.appDeepLink);
  assert.equal(appLink.protocol + "//" + appLink.host, "omgskills://group");
  assert.equal(appLink.searchParams.get("url"), `https://omgskills.com/u/alice/sets/set-${id(1)}`);
  assert.equal(Object.hasOwn(owner.group, "ownerHandle"), false);
  for (const [groupId, actor, role] of [[id(3), "invited", "invited"], [id(4), "stranger", "public"]]) {
    const detail = await f.read(`groups/${groupId}`, actor);
    assert.equal(detail.accessRole, role); assert.deepEqual(detail.group.allowedEmails, []);
    for (const item of detail.items) {
      assert.equal(Object.hasOwn(item, "syncedSkillId"), false);
      assert.equal(Object.hasOwn(item, "catalogSkillId"), false);
    }
  }
  // A denied detail must stop at the access lookup, before loading either contents query.
  for (const [groupId, actor] of [[id(2), "alice"], [id(2), "invited"], [id(3), "stranger"], [id(5), "invited"], [id(9), "alice"]]) {
    const before = f.queries.length;
    const response = await f.api(request(`groups/${groupId}`, actor), context);
    assert.equal(response.status, 404); privateHeaders(response);
    assert.match(await response.text(), /Group not found/);
    assert.equal(f.queries.slice(before).length, 2); // User reconciliation and access facts only.
    assert.ok(f.queries.at(-1)!.text.includes('AS "ownerUserId"'));
  }
  assert.equal(f.calls.filter(call => call === "pool").length, 1);
  assert.equal(f.calls.filter(call => call === "identity").length, 1);
  assert.ok(f.queries.every(query => query.text.startsWith("SELECT") || query.text.startsWith("UPDATE users SET email")));
  f.unchanged();
}

test("five real account reads preserve owner isolation, Favorites, shared access, defaults and stable records", async () => {
  await readJourney();
});

test("new routes reject invalid requests before auth/pool and preflight never authenticates", async () => {
  const f = fixture();
  for (const path of paths) {
    const cases: [Request, number][] = [
      [request(path + "?userId=bob"), 400], [request(path + "?%75serId=bob"), 400],
      [request(path, "alice", { headers: { Authorization: "" } }), 401],
      [request(path, "alice", { headers: { Authorization: "Bearer device_" + "b".repeat(43) } }), 401],
      [request(path, "alice", { headers: { Authorization: "", Cookie: "__session=alice.payload.signature" } }), 401],
      [request(path, "alice", { headers: { Origin: "https://omgskills.com" } }), 403],
      [request(path, "alice", { headers: { "Sec-Fetch-Site": "cross-site" } }), 403],
    ];
    for (const method of ["POST", "PATCH", "DELETE", "HEAD"]) {
      cases.push([request(path, "alice", { method }), 405]);
      cases.push([request(path, "alice", { method: "OPTIONS", headers: { "Access-Control-Request-Method": method } }), 405]);
    }
    for (const [req, status] of cases) {
      const response = await f.api(req, context); assert.equal(response.status, status, `${req.method} ${req.url}`); privateHeaders(response);
    }
    const preflight = await f.api(request(path, "alice", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET" } }), context);
    assert.equal(preflight.status, 204); privateHeaders(preflight);
  }
  for (const path of ["groups/:groupId", "groups/invalid", `groups/${id(1).replaceAll("-", "")}`,
    `groups/%31${id(1).slice(1)}`, `groups/${id(1)}/items`, `devices/${id(1)}`, "private-sources", "settings"]) {
    const response = await f.api(request(path), context); assert.equal(response.status, 404, path); privateHeaders(response);
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.queries, []);
});

test("each account read fails closed on configuration and authentication without constructing a pool", async () => {
  for (const path of paths) {
    const f = fixture();
    for (const overrides of [{ CLERK_SECRET_KEY: "sk_live_NotAllowed" }, { OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: "other" },
      { OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: "wrong" }]) {
      const api = createConnectedCandidateApi({ ...f.deps, getEnvironment: () => ({ ...environment, ...overrides }) });
      const response = await api(request(path), context); assert.equal(response.status, 503); privateHeaders(response);
    }
    assert.deepEqual(f.calls, []);
    const response = await f.api(request(path, "invalid"), context);
    assert.equal(response.status, 401); privateHeaders(response);
    assert.deepEqual(f.calls, ["auth"]); assert.deepEqual(f.queries, []);
  }
});

test("read and access failures keep private headers and never expose database diagnostics", async () => {
  for (const [path, sql] of [["devices", "FROM device_tokens"], ["profile", "profile_published"],
    ["groups", "WHERE owner_user_id"], ["shared", "WHERE email"], [`groups/${id(1)}`, 'AS "ownerUserId"'],
    ["groups", 'AS "ownerUserId"'], ["shared", 'AS "ownerUserId"']]) {
    const f = fixture(); f.failOn(sql);
    const response = await f.api(request(path, path === "shared" ? "invited" : "alice"), context);
    assert.equal(response.status, 500, path); privateHeaders(response);
    assert.doesNotMatch(await response.text(), /password|diagnostic|MANAGED_LOADER/);
  }
});

test("bundled account reads and all access/list helpers never use managed database loaders", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dir = await mkdtemp(join(root, ".cc2b2a-unit-"));
  try {
    const output = await build({ entryPoints: [join(root, "scripts/connected-candidate-api.mts")],
      bundle: true, platform: "node", format: "esm", packages: "external", write: false,
      plugins: [{ name: "forbid-managed-db", setup(plugin) {
        plugin.onResolve({ filter: /\/db\.js$/ }, args => args.importer.includes("/netlify/functions/")
          ? { path: args.path, namespace: "forbidden-db" } : undefined);
        plugin.onLoad({ filter: /.*/, namespace: "forbidden-db" }, () => ({ contents:
          ["getPgPool", "getSqlDatabase", "getDrizzleDatabase"].map(name =>
            `export function ${name}(){throw Error("MANAGED_LOADER_WAS_USED");}`).join("\n"), loader: "js" }));
      } }] });
    const entry = join(dir, "candidate.mjs"); await writeFile(entry, output.outputFiles[0].text);
    await readJourney((await import(pathToFileURL(entry).href)).createConnectedCandidateApi);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("normal named handlers retain their mutation/method contracts outside candidate dispatch", async () => {
  const f = fixture();
  const requirePortalUser = async () => actors.alice;
  const calls: unknown[][] = [];
  const pool = { async query(text: string, values: unknown[]) {
    calls.push([text, ...values]);
    return text.includes("SELECT handle") ? { rows: [{ handle: "custom-name", profilePublished: true }] } : { rows: [] };
  } } as unknown as Pool;
  const profile = await portalProfile(request("profile", "alice", { method: "PATCH", body: JSON.stringify({ handle: "custom-name", profilePublished: true }) }),
    context, { requirePortalUser, getPgPool: () => pool });
  assert.equal(profile.status, 200); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(1), ["alice", "custom-name", true]); assert.match(calls[0][0] as string, /UPDATE users/);
  const deleted = await portalDevices(request(`devices/${id(1)}`, "alice", { method: "DELETE" }), context, {
    requirePortalUser, getPgPool: () => pool, listUserDevices,
    revokeOwnedDevice: async (actual, userId, deviceId) => { assert.equal(actual, pool); assert.equal(userId, "alice"); return deviceId; },
  });
  assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { deviceId: id(1), revoked: true });
  const denied = async () => { throw new Response("Unit sign-in required", { status: 401 }); };
  assert.equal((await portalGroups(request("groups", "alice", { method: "DELETE" }), context)).status, 405);
  assert.equal((await portalShared(request("shared", "alice", { method: "POST" }), context)).status, 405);
  for (const handler of [portalProfile, portalDevices]) {
    assert.equal((await handler(request("unused", "alice", { method: "POST" }), context)).status, 405);
    assert.equal((await handler(request("unused"), context, { getPgPool: () => f.pool, requirePortalUser: denied,
      listUserDevices, revokeOwnedDevice })).status, 401);
  }
  assert.deepEqual(f.calls, []);
});
