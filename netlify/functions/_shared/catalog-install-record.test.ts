import assert from "node:assert/strict";
import test from "node:test";
import { OmgskillsLibrary, type Skill } from "../../../mcp/src/library.js";
import { createMcpHandler } from "../omgskills-mcp.mjs";
import type { McpLibraryLoader } from "./mcp-library.js";

const legacy: Skill = { id: "owner/repo:alias", name: "alias", description: "Skill", author_handle: "owner",
  github_url: "https://github.com/owner/repo", install_cmd: "ln -s /tmp/repo/skills/design ~/.claude/skills/old-alias" };
const pins = { repo_slug: "owner/repo", skill_md_path: "skills/design/SKILL.md",
  repo_commit_sha: "1".repeat(40), skill_tree_sha: "2".repeat(40), skill_md_sha: "3".repeat(40), install_target_name: "old-alias" };
function loader(skills: Skill[] = [legacy]): McpLibraryLoader {
  const library = OmgskillsLibrary.fromData({ skills, trending: [], goldBasket: [] });
  return { get: async () => ({ library, sourceTrack: "crawl4", loadedAt: 0, skillCount: skills.length,
    trendingCount: 0, goldBasketCount: 0 }), refresh: async () => { throw Error("unused"); },
    pendingRefresh: () => null, status: () => ({ hasSnapshot: true, refreshing: false,
      lastRefreshFailed: false, maxAgeMs: 600_000 }) };
}
const context = { waitUntil: (_work: Promise<unknown>) => {} };
const request = (query: string, method = "GET") => new Request(`https://example.test/api/catalog/install-record?${query}`, { method });

for (const [label, record] of Object.entries({ legacy, pinned: { ...legacy, ...pins },
  partial: { ...legacy, repo_commit_sha: "not-a-pin" }, emptyPin: { ...legacy, repo_slug: "" } })) {
  test(`returns intact ${label} installation fields, without the whole catalog`, async () => {
    const response = await createMcpHandler(loader([record]))(request(`id=${encodeURIComponent(record.id)}`), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, found: true, skill: record });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
}
test("missing ID is an exact lookup, not search or a fallback", async () => {
  const response = await createMcpHandler(loader())(request("id=owner%2Frepo"), context);
  assert.deepEqual(await response.json(), { version: 1, found: false, skill: null });
});
for (const query of ["", "id=", "id=%20", "id=x&id=y", "id=x&repo=evil", "id=" + "a".repeat(501), "id=%00", "id=%E2%80%8B"]) {
  test(`rejects malformed query ${query.slice(0, 30)} before loading`, async () => {
    const source = loader(); source.get = async () => { throw Error("must not load"); };
    assert.equal((await createMcpHandler(source)(request(query), context)).status, 400);
  });
}
test("rejects POST and unavailable catalogs", async () => {
  const source = loader(); source.get = async () => { throw Error("offline"); };
  assert.equal((await createMcpHandler(source)(request("id=x", "POST"), context)).status, 405);
  assert.equal((await createMcpHandler(source)(request("id=x"), context)).status, 503);
});
test("bounds large records and retains the shared refresh", async () => {
  const source = loader([{ ...legacy, description: "x".repeat(256 * 1024) }]);
  const refresh = source.get(); source.pendingRefresh = () => refresh;
  const pending: Promise<unknown>[] = [];
  assert.equal((await createMcpHandler(source)(request(`id=${legacy.id}`), { waitUntil: work => { pending.push(work); } })).status, 503);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
});
