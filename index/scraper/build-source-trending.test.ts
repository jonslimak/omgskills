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

test("links a same-repo library skill by its folder when the library ID carries a path", () => {
  const feed = buildSourceTrending([row("owner/repo", "copywriting"), row("owner/repo", "seo")], [
    { id: "owner/repo:skills/copywriting", name: "copywriting", skill_md_path: "skills/copywriting/SKILL.md", github_url: "https://github.com/owner/repo" },
    { id: "other/repo:seo", name: "seo", skill_md_path: "seo/SKILL.md", github_url: "https://github.com/other/repo" },
  ], policy, date);
  assert.deepEqual(feed.entries.map(e => e.catalogId), ["owner/repo:skills/copywriting", undefined]);
});

test("leaves an entry unlinked when two library skills in the repo share its folder name", () => {
  const feed = buildSourceTrending([row("owner/repo", "lint")], [
    { id: "owner/repo:a/lint", name: "lint", skill_md_path: "a/lint/SKILL.md" },
    { id: "owner/repo:b/lint", name: "lint", skill_md_path: "b/lint/SKILL.md" },
  ], policy, date);
  assert.equal(feed.entries[0].catalogId, undefined);
});

test("hides intake-blocked entries and unreviewed entries from copying repos, never library skills", () => {
  const feed = buildSourceTrending([row("copy/repo", "a"), row("copy/repo", "b"), row("copy/repo", "kept"), row("new/repo", "x"), row("safe/repo", "y")],
    [{ id: "copy/repo:kept", name: "kept" }], {
      ...policy, reviewBlockedIds: ["copy/repo:a", "safe/repo:y"], copyRepos: ["copy/repo"],
    }, date);
  assert.deepEqual(feed.entries.map(e => `${e.source}:${e.skillId}`), ["copy/repo:kept", "new/repo:x"]);
});

test("keeps a dated copy of each refreshed feed, and none on a source outage", async t => {
  const dir = mkdtempSync(join(tmpdir(), "source-trending-snapshot-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshotDir = join(dir, "snapshots");
  const input = { skills: [], policy, outputPath: join(dir, "feed.json"), snapshotDir };
  await refreshSourceTrending({ ...input, entries: [row("new/repo")], now: () => date });
  assert.deepEqual(readFileSync(join(snapshotDir, "source-trending-2026-11-09.json")), readFileSync(input.outputPath));
  await refreshSourceTrending({ ...input, now: () => "2026-11-10T10:00:00Z",
    fetchBoard: async () => { throw new SkillsShUnavailableError("timeout"); } });
  assert.throws(() => readFileSync(join(snapshotDir, "source-trending-2026-11-10.json")));
});
