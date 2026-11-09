import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSourceTrending, refreshSourceTrending } from "./build-source-trending.js";
import { SkillsShUnavailableError } from "./sources/skillssh.js";

const policy = { blockedRepos: [], blockedOwners: [], catalogRepos: [], suppressedIds: [] };
const row = (source: string, skillId = "skill", installs = 123) => ({ source, skillId, name: skillId, installs });
const date = "2026-11-09T10:00:00Z";

test("keeps unindexed and non-GitHub source entries, source order, and 24h counts", () => {
  const feed = buildSourceTrending([row("new/repo"), row("uizze.sh"), row("known/repo")],
    [{ id: "known/repo:skill", name: "skill" }], policy, date);
  assert.deepEqual(feed.entries.map(e => [e.source, e.rank, e.installs24h, e.catalogId]), [
    ["new/repo", 1, 123, undefined], ["uizze.sh", 2, 123, undefined], ["known/repo", 3, 123, "known/repo:skill"],
  ]);
  assert.equal(feed.fetchedAt, date);
});

test("does not diversify or reorder a repo and never maps a name from another source", () => {
  const feed = buildSourceTrending([row("new/repo", "a"), row("new/repo", "b"), row("new/repo", "c")],
    [{ id: "other/repo:a", name: "a" }], policy, date);
  assert.deepEqual(feed.entries.map(e => e.rank), [1, 2, 3]);
  assert.ok(feed.entries.every(e => !e.catalogId));
});

test("case-insensitive identity links preserve the catalog ID without rewriting it", () => {
  const feed = buildSourceTrending([row("owner/repo")], [{ id: "Owner/Repo:skill", name: "skill" }], policy, date);
  assert.equal(feed.entries[0].catalogId, "Owner/Repo:skill");
});

test("explicit repo, owner, catalog, and skill exclusions keep original rank gaps", () => {
  const feed = buildSourceTrending([row("blocked/repo"), row("owner/repo"), row("catalog/repo"), row("suppressed/repo"), row("safe/repo")], [], {
    blockedRepos: ["BLOCKED/REPO"], blockedOwners: ["OWNER"], catalogRepos: ["catalog/repo"], suppressedIds: ["suppressed/repo:skill"],
  }, date);
  assert.deepEqual(feed.entries.map(e => [e.source, e.rank]), [["safe/repo", 5]]);
});

test("retains last-good bytes and fetch time on source outage; invalid data fails closed", async t => {
  const dir = mkdtempSync(join(tmpdir(), "source-trending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outputPath = join(dir, "feed.json");
  const input = { skills: [], policy, outputPath, now: () => date };
  await refreshSourceTrending({ ...input, entries: [row("new/repo")] });
  const before = readFileSync(outputPath);
  const previous = await refreshSourceTrending({ ...input, now: () => "2026-11-10T10:00:00Z",
    fetchBoard: async () => { throw new SkillsShUnavailableError("timeout"); } });
  assert.equal(previous.fetchedAt, date);
  assert.deepEqual(readFileSync(outputPath), before);
  await assert.rejects(refreshSourceTrending({ ...input, entries: [row("javascript:evil")] }), /Invalid/);
  await assert.rejects(refreshSourceTrending({ ...input, entries: [] }), /no entries/);
  assert.deepEqual(readFileSync(outputPath), before);
});
