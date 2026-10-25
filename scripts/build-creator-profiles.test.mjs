import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { creatorProfilesSummary, buildCreatorProfiles } from "./build-creator-profiles.mjs";

const collections = { collections: [{ type: "author", authorHandle: "anthropics", title: "Anthropic",
  description: "Official skills for documents.", githubUrl: "https://github.com/anthropics", xUrl: "https://x.com/AnthropicAI" },
  { type: "topic", id: "design", title: "Design" }] };
const authors = [{ authorHandle: "anthropics", stats: { skillCount: 395, totalStars: 15681887, totalInstalls: 2046054,
  bestSkill: { id: "anthropics/skills:pptx", name: "pptx", stars: 182146 }, editorialScore: 830 }, leaderboardCategories: {
    influential: { rank: 1, value: "15.7M \u2b50", detail: "Unused detail" },
    "most-used": { rank: 6, value: "2.0M installs" }, peak: { rank: 9, value: "182.1k \u2b50" }, prolific: { rank: 6, value: "395 skills" },
  } }];

test("creator summary projects the existing public profile fields without raw catalog or editorial data", () => {
  const value = creatorProfilesSummary(collections, authors, "2026-10-19T16:34:44Z");
  assert.deepEqual(Object.keys(value.profiles), ["anthropics"]);
  assert.deepEqual(value.profiles.anthropics, { description: "Official skills for documents.", githubUrl: "https://github.com/anthropics",
    xUrl: "https://x.com/AnthropicAI", skillCount: 395, totalStars: 15681887, totalInstalls: 2046054,
    bestSkill: { id: "anthropics/skills:pptx", name: "pptx" }, rankings: [
      { category: "influential", rank: 1, value: "15.7M stars" }, { category: "most-used", rank: 6, value: "2.0M installs" },
      { category: "peak", rank: 9, value: "182.1k stars" },
    ] });
  assert.equal(JSON.stringify(value).includes("editorialScore"), false);
});

test("missing stats remain absent, zero totals remain zero, and unsafe links are omitted", () => {
  const source = { collections: [{ ...collections.collections[0], githubUrl: "javascript:alert(1)", xUrl: "https://evil.example/anthropics" }] };
  assert.equal(creatorProfilesSummary(source, [], "date").profiles.anthropics.skillCount, undefined);
  const profile = creatorProfilesSummary(source, [{ authorHandle: "Anthropics", stats: { skillCount: 0, totalInstalls: 0, totalStars: -1 } }], "date").profiles.anthropics;
  assert.equal(profile.skillCount, 0);
  assert.equal(profile.totalInstalls, 0);
  assert.equal(profile.totalStars, undefined);
  assert.equal(profile.githubUrl, "https://github.com/anthropics");
  assert.equal(profile.xUrl, undefined);
  assert.equal(creatorProfilesSummary(collections, [], "date").profiles.constructor, undefined);
  assert.throws(() => creatorProfilesSummary({ collections: [collections.collections[0], collections.collections[0]] }, [], "date"), /duplicate/);
});

test("planned 675-profile expansion fits the bounded summary contract", () => {
  const make = count => ({ collections: Array.from({ length: count }, (_, i) => ({
    type: "author", authorHandle: `creator-${i}`, description: "d".repeat(500),
  })) });
  const summary = creatorProfilesSummary(make(675), [], "2026-10-25T00:00:00Z");
  const bytes = Buffer.byteLength(JSON.stringify(summary));
  assert.equal(Object.keys(summary.profiles).length, 675);
  assert.ok(bytes > 250_000 && bytes < 1_000_000);
  assert.equal(Object.keys(creatorProfilesSummary(make(1000), [], "date").profiles).length, 1000);
  assert.throws(() => creatorProfilesSummary(make(1001), [], "date"), /profile limit/);
});

test("build reads only small metadata plus author stats, verifies source hashes and honors the summary budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "creator-summary-"));
  try {
    const siteDir = path.join(root, "site"), outputPath = path.join(root, "portal/public/creator-profiles.json");
    const directory = path.join(siteDir, "data/v2");
    await mkdir(directory, { recursive: true });
    const descriptor = async (name, value) => {
      const bytes = JSON.stringify(value), file = `${name}-123abc.json`;
      await writeFile(path.join(directory, file), bytes);
      return { path: file, bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
    };
    const manifest = { generatedAt: "2026-10-19T16:34:44Z", collections: await descriptor("collections", collections),
      authorLeaderboards: await descriptor("author-leaderboards", authors), skills: { path: "must-not-read.json" } };
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    const result = await buildCreatorProfiles({ siteDir, outputPath });
    assert.equal(result.profiles, 1);
    assert.ok(result.bytes < 2000);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).profiles.anthropics.skillCount, 395);
    await writeFile(path.join(directory, manifest.authorLeaderboards.path), "[]");
    await assert.rejects(buildCreatorProfiles({ siteDir, outputPath }), /integrity/);
    manifest.authorLeaderboards = await descriptor("author-leaderboards", authors);
    manifest.collections = await descriptor("collections", { collections: [{ ...collections.collections[0], description: "x".repeat(1_000_000) }] });
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(buildCreatorProfiles({ siteDir, outputPath }), /size budget/);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).profiles.anthropics.description, "Official skills for documents.");
  } finally { await rm(root, { recursive: true, force: true }); }
});
