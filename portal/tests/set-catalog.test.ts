import assert from "node:assert/strict";
import test from "node:test";
import { makeFixtures } from "../src/preview/fixtures";
import { loadSetCatalog, setCatalogIds } from "../src/app/unified/set-catalog";
import { PublicCatalogClient } from "../src/app/unified/public-catalog";

test("set lookup sends only explicit catalog IDs, in bounded batches, without account credentials", async () => {
  const set = makeFixtures().sets[0];
  const ids = Array.from({ length: 65 }, (_, n) => `author/repo:skill-${n}`);
  set.items = ids.map((id, n) => ({ id: String(n), name: "Private snapshot", description: "Private note",
    githubUrl: null, kind: "catalog", catalogSkillId: id }));
  set.items.push({ ...set.items[0], id: "duplicate" },
    { id: "private", kind: "synced", name: "Private skill", description: "Secret", githubUrl: null, catalogSkillId: "do-not-query" },
    { id: "github", kind: "github", name: "Private repo", description: "Secret", githubUrl: "https://github.com/private/repo" });
  assert.deepEqual(setCatalogIds(set), ids);
  const batches: string[][] = [];
  const client = new PublicCatalogClient(async (path, init) => {
    assert.equal(path, "/mcp");
    assert.equal(init?.credentials, "omit");
    const request = JSON.parse(init!.body as string);
    assert.equal(request.params.name, "get_skills");
    assert.deepEqual(Object.keys(request.params.arguments), ["ids"]);
    const requested = request.params.arguments.ids as string[];
    batches.push(requested);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { structuredContent: {
      skills: requested.filter(id => id !== ids[2]).map(id => ({ id, name: "Public skill", description: "Public description",
        github_url: "https://github.com/author/repo", author_handle: "author", tags: [] })),
    } } }), { headers: { "content-type": "application/json" } });
  });
  const result = await loadSetCatalog(client, setCatalogIds(set), new AbortController().signal);
  assert.deepEqual(batches.map(batch => batch.length), [30, 30, 5]);
  assert.equal(result.skills.length, 64);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.skills.map(skill => skill.id), ids.filter(id => id !== ids[2]));
  await loadSetCatalog(client, ids, new AbortController().signal);
  assert.equal(batches.length, 3, "Fresh revisits reuse the existing public cache");
});

test("cancelled lookup cannot deliver a late batch or request the next batch", async () => {
  const controller = new AbortController();
  let finish!: () => void;
  let calls = 0;
  const pending = loadSetCatalog({ collection: async () => {
    calls++;
    await new Promise<void>(resolve => { finish = resolve; });
    return { skills: [], missing: 0, limited: false };
  } }, Array.from({ length: 31 }, (_, i) => String(i)), controller.signal);
  controller.abort();
  finish();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("unavailable catalog can retry without modifying saved set data", async () => {
  const set = makeFixtures().sets[0];
  const before = structuredClone(set);
  let failed = true;
  const client = { collection: async () => {
    if (failed) throw new Error("offline");
    return { skills: [], missing: 1, limited: false };
  } };
  await assert.rejects(loadSetCatalog(client, ["author/repo:removed"], new AbortController().signal), /offline/);
  failed = false;
  assert.equal((await loadSetCatalog(client, ["author/repo:removed"], new AbortController().signal)).missing, 1);
  assert.deepEqual(set, before);
  assert.deepEqual(await loadSetCatalog(client, [], new AbortController().signal), { skills: [], missing: 0 });
});
