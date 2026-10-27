import assert from "node:assert/strict";
import test from "node:test";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { catalogSorts, PagingError, preparePage, pageInfo, type SkillPage } from "../src/paging.js";
import { rankedRequest, compareRanked, rankedWindow, type RankedMatch } from "../src/search-ranking.js";

const skill = (name: string, description = "General helper", stars = 100, extra = {}) => ({
  id: `owner/repo:${name}`, name, description, stars, author_handle: "owner", tags: [],
  github_url: "https://github.com/owner/repo", install_cmd: "legacy", ...extra,
}) as Skill;
const library = (skills: Skill[], version = "fixture") => OmgskillsLibrary.fromData({ skills, trending: [], goldBasket: [] }, version, { ranking: true });
const read = (skills: Skill[], query: string) => library(skills).searchRankedPage({ query, ranking: "web-v1", page: {}, limit: 100 }).skills;
const names = (rows: Skill[]) => rows.map(row => row.name);

test("bounded selection preserves every full-sort window, including negative scores and ties", () => {
  const matches: RankedMatch[] = Array.from({ length: 1501 }, (_, i) => ({ skill: skill(`item-${i}`),
    name: `item-${i % 100}`, stars: i % 21, score: i % 31 - 15, matchedAll: i % 7 === 0, exactId: i === 101 }));
  const expected = matches.slice().sort(compareRanked);
  for (const limit of [1, 20, 30, 100]) for (const offset of [0, 10, 30, 100, 750, 1490, 1501]) {
    assert.deepEqual(rankedWindow(matches.slice(), offset, limit), expected.slice(offset, offset + limit));
  }
  assert.deepEqual(rankedWindow([], 0, 30), []);
});

test("Mac-derived relevance cases: spelling, full terms, partial results and stopwords", () => {
  const app = [skill("design-html", "Build HTML design systems", 80000), skill("app-store-review", "App Store review guidelines", 81), skill("appstore-connect", "App Store Connect", 6)];
  assert.deepEqual(names(read(app, "appstore skill")), ["app-store-review", "appstore-connect"]);
  for (const q of ["app store", "APP-STORE", "appstore"]) assert.deepEqual(names(read(app, q)), names(read(app, "appstore skill")));
  const ios = [skill("design-html", "Design HTML pages", 80000), skill("ios-swift", "iOS development", 208), skill("apple-hig-designer", "Design Apple-style iOS apps", 109)];
  assert.equal(read(ios, "ios design")[0].name, "apple-hig-designer");
  assert.ok(names(read(ios, "ios design")).includes("design-html"));
  assert.equal(read([skill("skill-writer"), skill("design")], "skill")[0].name, "skill-writer");
  assert.deepEqual(read(ios, "ios ios design design"), read(ios, "ios design"));
  assert.equal(read(ios, "?!").length, 0);
});

test("quality penalties order matches without hiding negative-score or direct-query results", () => {
  const low = skill("ios-design", "iOS design", 0, { provenance_type: "repackaged" });
  assert.equal(read([low, skill("design", "design", 1e9)], "ios design")[0].id, low.id);
  assert.deepEqual(names(read([skill("a-ui-design", "UI design", 2), skill("b-ui-design", "UI design", 12)], "ui design")), ["b-ui-design", "a-ui-design"]);
  const original = skill("browser-use", "Browser automation", 500), collection = skill("browser-use-catalog", "Browser use collection", 220000, { provenance_type: "catalog" });
  assert.deepEqual(names(read([collection, original], "browser use")), ["browser-use", "browser-use-catalog"]);
  assert.equal(read([collection], collection.id)[0].id, collection.id);
  assert.deepEqual(names(read([skill("a-tools", "tools", 174000, { publisher_repo: "affaan-m/everything-claude-code" }), skill("b-tools", "tools", 58000)], "tools")), ["b-tools", "a-tools"]);
  const negative = read([skill("tiny", "design", 0, { provenance_type: "repackaged" })], "design extra absent");
  assert.equal(negative.length, 1); assert.ok(negative[0].score < 0);
});

test("a focused name and topic match outranks an unrelated repository popularity advantage", () => {
  const focused = skill("appstore-connect", "App Store API metadata", 7, { tags: ["app-store"] });
  const popular = skill("agent-app-store", "Agent app-store utility", 100000);
  assert.equal(read([popular, focused], "app store")[0].id, focused.id);
  const once = read([focused], "app store")[0].score;
  assert.equal(read([{ ...focused, tags: ["app-store", "app-store", "app-store-connect"] }], "app store")[0].score, once);
});

test("Unicode, exact tokens, direct IDs, URL fallback and missing stars remain usable", () => {
  const rows = [skill("design", "English text"), skill("other", "\u4e2d\u6587\u8bbe\u8ba1 workflow"), skill("caf\u00e9", "Writing"), skill("ui", "UI design", undefined), skill("misleading", "Nothing", 100, { github_url: "https://github.com/design/ui" })];
  assert.equal(read(rows, "\u4e2d\u6587")[0].name, "other");
  assert.equal(read(rows, "CAF\u00c9")[0].name, "caf\u00e9");
  assert.deepEqual(read(rows, "\uff44\uff45\uff53\uff49\uff47\uff4e"), read(rows, "design"));
  assert.equal(read(rows, "ui")[0].name, "ui");
  assert.equal(read(rows, "design")[0].name, "design");
  assert.equal(read(rows, rows[1].id)[0].id, rows[1].id);
  assert.ok(read(rows, "https://github.com/design/ui").some(row => row.name === "misleading"));
  const languages = [skill("a-ui", "UI design \u6296\u97f3\u641c\u7d22\u4f18\u5316\u77ed\u89c6\u9891\u641c\u7d22\u6392\u540d"), skill("b-ui", "UI design workflow")];
  assert.equal(read(languages, "ui design")[0].name, "a-ui"); // No language penalty.
  const boundaries = [skill("underscore", "foo_ui_bar"), skill("unicode", "\u{10000}ui\u{10000}"), skill("punctuation", "(ui)")];
  assert.deepEqual(names(read(boundaries, "ui")), ["punctuation", "underscore"]);
});

test("handle parsing and existing filters compose without broadening malformed author queries", () => {
  const l = library([skill("design"), skill("design-other", "design", 100, { author_handle: "other" })]);
  const q = { query: "@OWNER design", ranking: "web-v1" as const, page: {} };
  assert.equal(l.searchRankedPage(q).skills.length, 1);
  assert.deepEqual(l.searchRankedPage({ ...q, author: "owner" }), l.searchRankedPage(q));
  for (const query of ["@", "@@owner", "@owner @other", "@owner--bad design", "@owner/evil"]) {
    assert.throws(() => l.searchRankedPage({ ...q, query }), (e: unknown) => e instanceof PagingError && e.code === "invalid_cursor");
  }
  assert.throws(() => l.searchRankedPage({ ...q, author: "other" }), /Invalid paging/);
  assert.equal(l.searchRankedPage({ ...q, minStars: 1000 }).page.total, 0);
  assert.equal(l.searchRankedPage({ ...q, tag: "absent" }).page.total, 0);
  assert.equal(rankedRequest({ query: "person@owner.com" }).author, undefined);
  assert.equal(l.searchRankedPage({ ...q, query: "@owner" }).page.total, 1);
  assert.equal(l.searchRankedPage({ ...q, query: "" }).page.total, 0);
  assert.deepEqual(l.searchRankedPage({ ...q, query: "", author: "owner" }).skills, l.searchPage({ query: "", author: "owner", page: {} }).skills);
});

test("ranked pages traverse the full matching set under all sorts and filters", () => {
  const skills = Array.from({ length: 257 }, (_, i) => skill(`design-${String(i).padStart(3, "0")}`, "workflow", i % 17, { tags: [i % 2 ? "odd" : "even"], first_seen: "2026-01-01", last_updated: "2026-02-01" }));
  const l = library(skills), base = { query: "design", ranking: "web-v1" as const, page: {} };
  for (const sort of catalogSorts) for (const limit of [1, 20, 30, 100]) for (const filtered of [false, true]) {
    const selected = filtered ? skills.filter(row => row.tags!.includes("even") && row.stars! >= 5) : skills;
    const options = { ...base, sort, limit, ...(filtered ? { author: "owner", tag: "even", minStars: 5 } : {}) };
    let cursor: string | undefined; const actual: Skill[] = [];
    do {
      const result: SkillPage = l.searchRankedPage({ ...options, page: cursor ? { cursor } : {} });
      assert.equal(result.page.total, selected.length); actual.push(...result.skills);
      cursor = result.page.nextCursor ?? undefined; assert.ok(actual.length <= selected.length);
    } while (cursor);
    assert.equal(new Set(actual.map(row => row.id)).size, selected.length);
    const expected = sort === "relevance" ? selected.slice().sort((a, b) => ((b.stars! <= 3 ? -150 : 0) + Math.min(20, Math.log10(b.stars! + 1) * 4)) - ((a.stars! <= 3 ? -150 : 0) + Math.min(20, Math.log10(a.stars! + 1) * 4)) || b.stars! - a.stars! || a.id.localeCompare(b.id))
      : selected.slice().sort((a, b) => (["trending", "stars"].includes(sort) ? b.stars! - a.stars! : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id), `${sort}/${limit}/${filtered}`);
  }
  const options = { ...base, limit: 20 }, first = l.searchRankedPage(options), cursor = first.page.nextCursor!;
  for (const change of [{ query: "workflow" }, { author: "owner" }, { sort: "stars" }, { limit: 30 }]) assert.throws(() => l.searchRankedPage({ ...options, ...change, page: { cursor } } as never), /different arguments/);
  assert.throws(() => l.searchPage({ query: "design", limit: 20, page: { cursor } }), /different arguments/);
  assert.throws(() => l.searchRankedPage({ ...options, page: { cursor: l.searchPage({ query: "design", limit: 20, page: {} }).page.nextCursor! } }), /different arguments/);
  assert.deepEqual(l.searchRankedPage({ ...options, query: "DESIGN design", page: { cursor } }), l.searchRankedPage({ ...options, page: { cursor } }));
  assert.throws(() => library(skills, "changed").searchRankedPage({ ...options, page: { cursor } }), /catalog changed/i);
  assert.throws(() => l.searchRankedPage({ ...options, query: "\u4e2d".repeat(400) }), /Invalid paging/);
  assert.throws(() => OmgskillsLibrary.fromData({ skills, trending: [], goldBasket: [] }, "fixture").searchRankedPage(options), /Ranking/);
  const previousPolicy = preparePage("fixture", "search_skills", { query: "design", limit: 20, page: {} },
    { policy: "web-v1:normalization-1:collection-origin-v1", terms: ["design"], exactQuery: "" });
  assert.throws(() => l.searchRankedPage({ ...options, page: { cursor: pageInfo(previousPolicy, 257).nextCursor! } }), /different arguments/);
});

test("count-first pages preserve partial rows when crossing the complete-match boundary", () => {
  const skills = Array.from({ length: 340 }, (_, i) => skill(`tool-${String(i).padStart(3, "0")}`, i < 83 ? "ios design" : "design", i % 17,
    { provenance_type: i % 9 === 0 ? "catalog" : "original" }));
  const score = (i: number) => (i < 83 ? 1050 : -25) + Math.min(20, Math.log10(i % 17 + 1) * 4) - (i % 17 <= 3 ? 150 : 0) - (i % 9 === 0 ? 250 : 0);
  const expected = skills.map((s, i) => ({ skill: s, i })).sort((a, b) => Number(b.i < 83) - Number(a.i < 83) || score(b.i) - score(a.i) || b.i % 17 - a.i % 17 || a.i - b.i).map(row => row.skill.id);
  const l = library(skills);
  for (const limit of [1, 20, 30, 100]) {
    let cursor: string | undefined; const actual: string[] = [];
    do {
      const page = l.searchRankedPage({ query: "ios design", ranking: "web-v1", limit, page: cursor ? { cursor } : {} });
      assert.equal(page.page.total, 340); actual.push(...page.skills.map(row => row.id)); cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(actual, expected);
  }
  const broken = OmgskillsLibrary.fromData({ skills, goldBasket: [], trending: [{ id: skills.at(-1)!.id, trending_rank: -1 }] }, "fixture", { ranking: true });
  assert.throws(() => broken.searchRankedPage({ query: "ios design", ranking: "web-v1", limit: 1, page: {} }), /unavailable/);
});
