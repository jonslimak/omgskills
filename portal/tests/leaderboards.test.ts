import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createLeaderboardLoader, leaderboardAssetPath, leaderboardCategoryIds, leaderboardRows, parseLeaderboards } from "../src/app/unified/leaderboards";
import { LeaderboardSections, StarText } from "../src/app/unified/DataPage";
import { initialNavigation, isDiscovery, navigationSearch, openSkillNavigation, parseNavigation } from "../src/app/unified/model";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { entryNavigation } from "../src/integration/unified/entry-navigation";
import { publicPageRequest } from "../src/app/unified/public-paging";

const source = () => ({ version: 1, generatedAt: "2026-10-21T12:00:00Z",
  topSkills: Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, id: `author/skills:skill-${index}`,
    name: `Skill ${index}`, authorHandle: "author", githubUrl: "https://github.com/author/skills", stars: 100 + index, installs: 200 + index })),
  creatorCategories: leaderboardCategoryIds.map(id => ({ id, title: id, subtitle: `${id} metric`,
    rows: Array.from({ length: 12 }, (_, index) => ({ authorHandle: `creator-${index}`, isVendor: index === 0, value: `${index} stars`, detail: `${index} skills` })),
  })),
  allRounders: Array.from({ length: 12 }, (_, index) => ({ authorHandle: `creator-${index}`, isVendor: index === 0,
    skillCount: index, totalStars: index * 10, totalInstalls: index * 20, trophies: ["Most Used", "Most Influential"] })),
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const manifest = { leaderboardViewData: { path: "leaderboard-view-data-123456abcdef.json" } };

test("Data navigation is public and survives refresh, selection, and signed-out access", () => {
  const nav = { ...initialNavigation, view: "data" as const };
  assert.equal(isDiscovery(nav.view), true);
  assert.deepEqual(parseNavigation(navigationSearch(nav)), nav);
  assert.deepEqual(entryNavigation("/app/", "?view=data", "/app/"), nav);
  for (const signedIn of [true, false]) assert.deepEqual(accountNavigation(nav, signedIn), nav);
  assert.deepEqual(publicNavigation(nav), nav);
  assert.equal(publicPageRequest(nav), null);
  assert.equal(publicPageRequest({ ...nav, query: "React" })?.name, "search_skills");
  const opened = openSkillNavigation(nav, { key: "catalog:author/skills:skill-1", name: "Skill", author: "author", description: "", tags: [], githubUrl: null });
  assert.equal(opened.view, "data");
  assert.equal(accountNavigation(opened, false).selected, "catalog:author/skills:skill-1");
  assert.equal(publicNavigation({ ...nav, selected: "synced:private" }).selected, "");
});

test("published leaderboard payload parses without recalculating order, filters, or metrics", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../site/data/v2/manifest.json", import.meta.url), "utf8"));
  const raw = JSON.parse(readFileSync(new URL(`../../site/data/v2/${manifest.leaderboardViewData.path}`, import.meta.url), "utf8"));
  const parsed = parseLeaderboards(raw);
  assert.equal(parsed.generatedAt, raw.generatedAt);
  assert.deepEqual(parsed.topSkills.map(row => row.id), raw.topSkills.map((row: any) => row.id));
  assert.deepEqual(parsed.creatorCategories.map(row => row.id), raw.creatorCategories.map((row: any) => row.id));
  assert.deepEqual(parsed.creatorCategories[0].rows, raw.creatorCategories[0].rows);
  assert.deepEqual(parsed.allRounders, raw.allRounders);
});

test("company filtering preserves published flags and order without mutating the snapshot", () => {
  const data = parseLeaderboards(source());
  const before = structuredClone(data);
  assert.deepEqual(leaderboardRows(data.creatorCategories[0].rows, false).map(row => row.authorHandle),
    data.creatorCategories[0].rows.slice(1).map(row => row.authorHandle));
  assert.deepEqual(leaderboardRows(data.allRounders, true), data.allRounders);
  assert.deepEqual(data, before);
  assert.deepEqual(leaderboardRows([], false), []);
});

test("eight Discover-style sections initially show nine entries and offer See all", () => {
  const html = renderToStaticMarkup(createElement(LeaderboardSections, { data: parseLeaderboards(source()), creators: [], onCreator() {}, onSkill() {} }));
  assert.equal((html.match(/class="ua-creators ua-data-grid"/g) ?? []).length, 8);
  assert.equal((html.match(/class="ua-creator ua-data-row/g) ?? []).length, 72);
  assert.equal((html.match(/aria-label="See all /g) ?? []).length, 8);
  assert.ok(html.includes("Include companies"));
  assert.ok(html.includes('class="ua-page-heading ua-data-heading"'));
  assert.ok(html.includes('<h1>Data</h1><p>Updated on '));
  assert.ok(html.includes('class="ua-data-filter-button"'));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.ok(html.includes('lucide-users'));
  assert.equal(html.includes('role="switch"'), false);
  assert.ok(html.includes('<span class="ua-data-filter-label" role="status"></span>'));
  assert.match(html, /dateTime="2026-10-21T12:00:00Z"/i);
  assert.ok(html.includes("100"));
  assert.ok(html.includes("200 installs"));
  assert.equal(html.includes("Skill 9</strong>"), false);
  assert.equal(html.includes("@creator-0</strong>"), false);
  assert.equal(html.includes("@creator-10</strong>"), false);
  assert.ok(html.includes("Most Used"));
  assert.ok(html.includes("Most Influential"));
});

test("short and empty boards keep real entry counts rather than inventing slots", () => {
  const data = parseLeaderboards(source());
  data.topSkills = data.topSkills.slice(0, 2);
  data.creatorCategories.forEach(category => { category.rows = []; });
  data.allRounders = [];
  const html = renderToStaticMarkup(createElement(LeaderboardSections, { data, creators: [], onCreator() {}, onSkill() {} }));
  assert.equal((html.match(/class="ua-creator ua-data-row/g) ?? []).length, 2);
  assert.equal(html.includes("See all"), false);
  assert.equal((html.match(/No entries in this leaderboard/g) ?? []).length, 7);
});

test("leaderboard text is escaped and known creator names reuse metadata", () => {
  const data = parseLeaderboards(source());
  data.creatorCategories[0].rows[1].value = "<script>unsafe</script>";
  const html = renderToStaticMarkup(createElement(LeaderboardSections, { data,
    creators: [{ handle: "creator-1", name: "Known Creator", tagline: "", avatar: "https://github.com/creator-1.png?size=80" }], onCreator() {}, onSkill() {} }));
  assert.ok(html.includes("Known Creator"));
  assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
  assert.equal(html.includes("<script>"), false);
});

test("star units become accessible icons without changing numbers or other metrics", () => {
  const html = renderToStaticMarkup(createElement(StarText, { text: "15.7M stars / avg 39.7k \u2b50 per skill / 2M installs" }));
  assert.equal((html.match(/class="ua-data-star-unit"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-label="stars"/g) ?? []).length, 2);
  assert.ok(html.includes("15.7M "));
  assert.ok(html.includes("avg 39.7k "));
  assert.ok(html.includes("per skill / 2M installs"));
  assert.equal(/>[^<]*\bstars\b[^<]*</i.test(html), false);
  assert.equal(html.includes("\u2b50"), false);
});

test("creator totals, averages, and All-Rounders use star icons while skill names remain text", () => {
  const data = parseLeaderboards(source());
  data.creatorCategories[0].rows[1].detail = "avg 39.7k stars per skill";
  data.creatorCategories[2].rows[1].detail = '"count-stars"';
  const html = renderToStaticMarkup(createElement(LeaderboardSections, { data, creators: [], onCreator() {}, onSkill() {} }));
  const influential = html.slice(html.indexOf('id="ua-data-influential"'), html.indexOf('aria-labelledby="ua-data-most-used-title"'));
  const allRounders = html.slice(html.indexOf('id="ua-data-all-rounders"'));
  assert.ok(influential.includes('class="ua-data-star-unit"'));
  assert.equal(/>[^<]*\bstars\b[^<]*</i.test(influential), false);
  assert.ok(allRounders.includes('class="ua-data-star-unit"'));
  assert.equal(/>[^<]*\bstars\b[^<]*</i.test(allRounders), false);
  assert.ok(html.includes('&quot;count-stars&quot;'));
});

test("invalid rows, unknown categories, duplicates, unsafe links, and negative totals are rejected", () => {
  const changes = [
    (value: any) => { value.version = 2; },
    (value: any) => { value.generatedAt = "invalid"; },
    (value: any) => { value.creatorCategories[0].id = "unknown"; },
    (value: any) => { value.creatorCategories.pop(); },
    (value: any) => { value.creatorCategories[1].id = value.creatorCategories[0].id; },
    (value: any) => { value.topSkills[0].githubUrl = "javascript:alert(1)"; },
    (value: any) => { value.topSkills[0].githubUrl = "https://github.com@evil.example/author"; },
    (value: any) => { value.topSkills[0].stars = -1; },
    (value: any) => { value.topSkills[0].id = "bad\nidentity"; },
    (value: any) => { value.topSkills[1].id = value.topSkills[0].id; },
    (value: any) => { value.creatorCategories[0].rows[0].isVendor = "false"; },
    (value: any) => { value.allRounders[0].authorHandle = "../private"; },
    (value: any) => { value.allRounders[0].totalInstalls = -1; },
    (value: any) => { value.allRounders[0].trophies = Array(7).fill("bad"); },
  ];
  for (const change of changes) { const data = source(); change(data); assert.throws(() => parseLeaderboards(data)); }
});

test("manifest references can only request the public v2 leaderboard file", () => {
  assert.equal(leaderboardAssetPath(manifest), "/data/v2/leaderboard-view-data-123456abcdef.json");
  for (const path of ["../private.json", "https://evil.example/data.json", "collections-123456abcdef.json", "leaderboard-view-data.json?secret=1", "%2e%2e/private.json"]) {
    assert.throws(() => leaderboardAssetPath({ leaderboardViewData: { path } }));
  }
});

test("the loader shares bounded read-only requests, expires, and sends no account data", async () => {
  const calls: string[] = [];
  let now = 0;
  const load = createLeaderboardLoader(async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.body, undefined);
    assert.equal(init?.method, undefined);
    assert.deepEqual(init?.headers, { Accept: "application/json" });
    return json(String(url).endsWith("manifest.json") ? manifest : source());
  }, () => now);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(a, b);
  assert.deepEqual(calls, ["/data/v2/manifest.json", "/data/v2/leaderboard-view-data-123456abcdef.json"]);
  await load();
  assert.equal(calls.length, 2);
  now = 600_001;
  await load();
  assert.equal(calls.length, 4);
});

test("failed and oversized responses can retry without loading the full catalog", async () => {
  let calls = 0;
  const load = createLeaderboardLoader(async url => {
    if (++calls === 1) return new Response("missing", { status: 404 });
    return json(String(url).endsWith("manifest.json") ? manifest : source());
  });
  await assert.rejects(load());
  assert.equal((await load()).topSkills.length, 10);
  const oversized = createLeaderboardLoader(async url => String(url).endsWith("manifest.json") ? json(manifest)
    : new Response("x".repeat(1_000_001), { headers: { "content-type": "application/json" } }));
  await assert.rejects(oversized());
  const html = createLeaderboardLoader(async () => new Response("<html>Not data</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(html());
});

test("Data is present in both navigation menus and reuses Discover responsive columns", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.ok(app.includes('navItem("data", "Data", ChartNoAxesColumn)'));
  assert.ok(app.includes('["data", "Data", ChartNoAxesColumn, false, ""]'));
  assert.ok(app.includes('const dataPage = nav.view === "data" && !nav.query.trim();'));
  assert.match(css, /\.ua-data-companies \.ua-data-filter-button \{[^}]*background: transparent;/);
  assert.match(css, /@media \(min-width: 760px\) \{\s*\.ua-data-filter-button svg \{\s*width: 16px;\s*height: 16px;\s*color: var\(--ua-faint\);/);
  assert.match(css, /\.ua-creator\.ua-data-row > \.ua-rank \{[^}]*flex: 0 0 16px;/);
  assert.match(css, /\.ua-creator\.ua-data-row > \.ua-row-open \{[^}]*flex: 0 0 30px;/);
  assert.match(css, /\.ua-trending,\s*\.ua-creators \{\s*display: grid;\s*grid-template-columns: repeat\(3/);
  assert.match(css, /@container \(max-width: 650px\) \{\s*\.ua-trending,\s*\.ua-creators \{\s*grid-template-columns: repeat\(2/);
  const mobile = css.slice(css.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.ua-trending,\s*\.ua-creators \{\s*grid-template-columns: 1fr/);
});

test("company icon feedback lasts two seconds and cleans up when its state changes", () => {
  const component = readFileSync(new URL("../src/app/unified/DataPage.tsx", import.meta.url), "utf8");
  assert.ok(component.includes('includeCompanies ? <BuildingComplex aria-hidden="true" /> : <Users aria-hidden="true" />'));
  assert.ok(component.includes('setShowLabel(includeCompanies);'));
  assert.ok(component.includes('if (!includeCompanies) return;'));
  assert.ok(component.includes('setTimeout(() => setShowLabel(false), 2000)'));
  assert.ok(component.includes('return () => clearTimeout(timer);'));
  assert.ok(component.includes('}, [includeCompanies]);'));
});
