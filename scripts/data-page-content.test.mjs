import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshDataPage, replaceDataPageContent } from "./data-page-content.mjs";
import { renderLeaderboards } from "../site/data/leaderboards.js";

const site = new URL("../site/", import.meta.url).pathname;
const data = {
  generatedAt: "2026-11-19T10:00:00.000Z",
  topSkills: [
    { rank: 1, id: "a/b:one", name: "one", authorHandle: "a", installs: 1200, stars: 30, githubUrl: "https://github.com/a/b" },
    { rank: 2, id: "c/d:two", name: "<two>", authorHandle: "c", installs: 5, stars: 1, githubUrl: "https://github.com/c/d" }
  ],
  creatorCategories: [{ id: "x", icon: "🏆", title: "Most", subtitle: "Stars", insight: "Why", color: { bg: "#fff", accent: "#000", border: "#eee", medal: "#f00" },
    rows: [{ authorHandle: "a", isVendor: false, value: "1k", detail: "2 skills" }] }],
  allRounders: [{ authorHandle: "a", isVendor: true, skillCount: 2, totalStars: 30, totalInstalls: 1200, trophies: ["🏆 Most"] }]
};

test("the leaderboards render as plain HTML, linking skills to their own pages when they have one", () => {
  const html = renderLeaderboards(data, { "a/b:one": "/library/a/b/one/" });
  assert.match(html, /<h1 class="page-section-title">Top Skills this Week<\/h1>/);
  assert.match(html, /<time datetime="2026-11-19">2026-11-19<\/time>/);
  assert.match(html, /<a class="skill-link" href="\/library\/a\/b\/one\/">one<\/a>/);
  assert.match(html, /<a class="skill-link" href="https:\/\/github.com\/c\/d" target="_blank" rel="noreferrer">&lt;two&gt;<\/a>/);
  assert.match(html, /data-vendor="1"/);
  assert.throws(() => renderLeaderboards({ ...data, generatedAt: "soon" }), /Invalid leaderboard view data/);
});

test("the build fills the data page from the published data, once, between its markers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "data-page-"));
  await cp(path.join(site, "data", "index.html"), path.join(dir, "data", "index.html"), { recursive: true });
  await cp(path.join(site, "data", "v2"), path.join(dir, "data", "v2"), { recursive: true });
  await refreshDataPage({ siteDir: dir });
  const once = await readFile(path.join(dir, "data", "index.html"), "utf8");
  assert.doesNotMatch(once, /Loading leaderboards/);
  assert.equal(once.match(/<h1 /g).length, 1);
  assert.ok((once.match(/class="lb-row/g) ?? []).length >= 10);
  await refreshDataPage({ siteDir: dir });
  assert.equal(await readFile(path.join(dir, "data", "index.html"), "utf8"), once);
  assert.throws(() => replaceDataPageContent("<main></main>", "x"), /Invalid data page markers/);
});
