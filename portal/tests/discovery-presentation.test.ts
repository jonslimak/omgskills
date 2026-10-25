import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discoveryCreatorGroups, featuredProfiles, isCompany } from "../src/app/unified/discovery-presentation";
import { initialNavigation, navigationSearch, parseNavigation, type CreatorDisplay } from "../src/app/unified/model";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { publicPageRequest } from "../src/app/unified/public-paging";
import { discoveryCategories } from "../src/app/unified/discovery-categories";

const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");

test("company grouping matches the Mac app for every published profile", () => {
  const mac = readFileSync(new URL("../../menubar/Sources/omgskills/SkillCollection.swift", import.meta.url), "utf8");
  const block = mac.match(/private static let legacyCompanyCollectionIds: Set<String> = \[([\s\S]*?)\]/)?.[1];
  assert.ok(block);
  const companies = new Set([...block.matchAll(/"author-([^"]+)"/g)].map(match => match[1]));
  const profiles = JSON.parse(readFileSync(new URL("../public/creator-profiles.json", import.meta.url), "utf8"));
  const handles = new Set([...companies, ...Object.keys(profiles.profiles), "mattpocock", "emilkowalski"]);
  for (const handle of handles) assert.equal(isCompany(handle), companies.has(handle), handle);
  assert.equal(isCompany("ANTHROPICS"), true);
});

test("company and creator lists are separate, alphabetical and do not mutate metadata", () => {
  const items: CreatorDisplay[] = [
    { handle: "mattpocock", name: "Matt Pocock", tagline: "" },
    { handle: "vercel", name: "Vercel", tagline: "" },
    { handle: "anthropics", name: "Anthropic", tagline: "" },
    { handle: "emilkowalski", name: "Emil Kowalski", tagline: "" },
  ];
  const before = structuredClone(items);
  const groups = discoveryCreatorGroups(items);
  assert.deepEqual(groups.companies.map(item => item.handle), ["anthropics", "vercel"]);
  assert.deepEqual(groups.creators.map(item => item.handle), ["emilkowalski", "mattpocock"]);
  assert.equal(groups.companies.length + groups.creators.length, items.length);
  assert.deepEqual(items, before);
  assert.deepEqual(discoveryCreatorGroups([]), { companies: [], creators: [] });
});

test("explicit company metadata overrides legacy names and keeps navigation classification consistent", () => {
  const items: CreatorDisplay[] = [
    { handle: "newco", name: "New Company", tagline: "", isCompany: true },
    { handle: "openai", name: "Explicit Creator", tagline: "", isCompany: false },
    { handle: "vercel", name: "Legacy Company", tagline: "" },
  ];
  const before = structuredClone(items);
  const groups = discoveryCreatorGroups(items);
  assert.deepEqual(groups.companies.map(item => item.handle), ["vercel", "newco"]);
  assert.deepEqual(groups.creators.map(item => item.handle), ["openai"]);
  assert.equal(isCompany("newco", true), true);
  assert.equal(isCompany("openai", false), false);
  assert.equal(isCompany("openai"), true);
  assert.deepEqual(items, before);
  assert.equal((source.match(/isCompany\(nav.id, creator\?\.isCompany\)/g) ?? []).length, 2);
});

test("company browse links stay public, retain their group and need no skill search", () => {
  const nav = { ...initialNavigation, view: "creators" as const, id: "companies" };
  assert.deepEqual(parseNavigation(navigationSearch(nav)), nav);
  assert.deepEqual(accountNavigation(nav, false), nav);
  assert.deepEqual(publicNavigation(nav), nav);
  assert.equal(publicPageRequest(nav), null);
  assert.equal(parseNavigation("?view=creators&id=unknown").id, "");
});

test("Discover features the approved nine companies and nine creators without reordering full lists", () => {
  const { profiles } = JSON.parse(readFileSync(new URL("../public/creator-profiles.json", import.meta.url), "utf8"));
  const items = Object.keys(profiles).map(handle => ({ handle, name: handle, tagline: "" }));
  const groups = discoveryCreatorGroups(items);
  const before = structuredClone(groups);
  assert.deepEqual(featuredProfiles(groups.companies, 9).map(item => item.handle), [
    "anthropics", "openai", "microsoft", "google-gemini", "github", "vercel",
    "cloudflare", "huggingface", "firebase",
  ]);
  assert.deepEqual(featuredProfiles(groups.creators, 9).map(item => item.handle), [
    "mattpocock", "emilkowalski", "garrytan", "steipete", "twostraws", "addyosmani",
    "coreyhaines31", "obra", "blader",
  ]);
  assert.deepEqual(groups, before);
  assert.ok(source.includes('const shown = limit === undefined ? items : featuredProfiles(items, limit);'));
});

test("featured lists skip unavailable profiles and fill remaining spots from existing metadata", () => {
  const items: CreatorDisplay[] = [
    { handle: "z-creator", name: "Z creator", tagline: "" },
    { handle: "MATTPOCOCK", name: "Matt Pocock", tagline: "" },
    { handle: "a-creator", name: "A creator", tagline: "" },
  ];
  assert.deepEqual(featuredProfiles(items, 9).map(item => item.handle), ["MATTPOCOCK", "a-creator", "z-creator"]);
  assert.equal(featuredProfiles(items, 1).length, 1);
  assert.deepEqual(featuredProfiles([], 9), []);
  assert.deepEqual(items.map(item => item.handle), ["z-creator", "MATTPOCOCK", "a-creator"]);
});

test("legacy category groups return to Discover while exact categories remain searches", () => {
  for (const group of discoveryCategories) {
    const grouped = parseNavigation(`?${new URLSearchParams({ view: "category", id: group.label })}`);
    assert.deepEqual(grouped, { ...initialNavigation, view: "discover" });
    for (const term of group.items) {
      const linked = parseNavigation(`?${new URLSearchParams({ view: "category", id: term })}`);
      assert.deepEqual(linked, { ...initialNavigation, view: "discover", query: term });
    }
  }
  assert.equal(parseNavigation("?view=category&id=React&q=testing").query, "testing");
});

test("Discover shows Today while search titles and other page titles stay independent", () => {
  assert.ok(source.includes('const showCollectionPager = nav.view === "discover" && !nav.query;'));
  assert.ok(source.includes('<h1>{showCollectionPager ? "Today" : title}</h1>'));
  assert.ok(/const title = nav.query\s*\? submittedQuery === nav.query \? .* : "Search results"\s*: titles\[nav.view\];/.test(source));
  assert.equal(source.includes("DiscoverClock"), false);
});

test("Discover previews nine of each group and keeps direct category search buttons", () => {
  assert.ok(source.includes('CreatorList({ items: creatorGroups.companies, limit: 9 })'));
  assert.ok(source.includes('CreatorList({ items: creatorGroups.creators, limit: 9 })'));
  assert.ok(source.includes('action={() => go("creators", "companies")}'));
  assert.ok(source.includes('action={() => go("creators")}'));
  assert.ok(source.includes('query: item, selected: "", source: "all"'));
  assert.equal(source.includes('navItem(\n                      "category"'), false);
  assert.ok(source.includes('placeholder="Search skills"'));
  assert.ok(source.includes('showCollectionPager ? "Today" : title'));
});

test("app focus removes hard outlines without recoloring controls", () => {
  assert.match(styles, /\.ua-theme :focus\s*\{\s*outline: none;/);
  assert.equal(styles.includes('--ua-focus-bg'), false);
  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1].includes(':focus')) {
      assert.doesNotMatch(rule[2], /(?:background(?:-color)?|box-shadow|filter|opacity)\s*:/);
    }
  }
  assert.equal(/outline:\s*[^;}]*\bsolid\b/.test(styles), false);
  assert.equal(styles.includes('.ua-data-filter-button:focus-visible'), false);
});

test("selected skills use the sidebar background in both themes", () => {
  assert.match(styles, /\.ua-row\[data-selected="true"\]\s*\{\s*background: var\(--ua-side\)/);
  assert.match(styles, /\.ua-sidebar\s*\{[^}]*background: var\(--ua-side\)/);
});

test("skill chevrons use circular backgrounds without changing other pills", () => {
  const circle = styles.match(/\.ua-row > \.ua-row-open\s*\{([^}]+)\}/)?.[1];
  assert.ok(circle);
  assert.match(circle, /width: 26px/);
  assert.match(circle, /min-width: 26px/);
  assert.match(circle, /padding: 0/);
  assert.match(circle, /border-radius: 50%/);
  assert.ok(source.includes('className="ua-pill ua-link ua-row-open"'));
});

test("Trending uses a star icon with its count rather than visible stars text", () => {
  assert.ok(source.includes('className="ua-trending-stars" aria-label={`${starCount(skill.stars)} stars`}'));
  assert.ok(source.includes('<Star aria-hidden="true" />{starCount(skill.stars)}'));
  assert.equal(source.includes('`${starCount(skill.stars)} stars` : ""].filter(Boolean)'), false);
  assert.match(styles, /\.ua-trending-stars\s*\{\s*display: inline-flex/);
});

test("Trending places its result count beside the worldwide subtitle without an empty control row", () => {
  assert.ok(source.includes('const trendingHeader = nav.view === "top" && !nav.query;'));
  assert.ok(source.includes('"Trending skills around the world"'));
  assert.equal(source.includes("A little inspiration for what to try next."), false);
  assert.ok(source.includes('trendingHeader ? <p className="ua-search-meta"><span>{meta}</span>{catalogCount}</p>'));
  assert.ok(source.includes('const catalogControls = publicList && publicStatus.page && !trendingHeader ?'));
  assert.ok(source.includes('trendingHeader ? " ua-heading-trending" : ""'));
});

test("Trending shares the Companies and Creators three, two and one-column breakpoints", () => {
  const grids = [...styles.matchAll(/\.ua-trending,\s*\.ua-creators\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.equal(grids.length, 3);
  assert.match(grids[0], /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(grids[1], /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(grids[2], /grid-template-columns: 1fr/);
  assert.match(styles, /@container \(max-width: 650px\)\s*\{\s*\.ua-trending,\s*\.ua-creators\s*\{\s*grid-template-columns: repeat\(2/);
  const mobile = styles.slice(styles.indexOf("@media (max-width: 759px)"));
  assert.match(mobile, /\.ua-trending,\s*\.ua-creators\s*\{\s*grid-template-columns: 1fr/);
  assert.equal(/\.ua-trending\s*\{[^}]*grid-template-columns/.test(styles), false);
});

test("category icon centers and names align with creator avatar and text columns", () => {
  const categories = styles.match(/\.ua-categories > div > div\s*\{([^}]+)\}/)?.[1];
  assert.ok(categories);
  assert.match(categories, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(categories, /column-gap: 28px/);
  const row = styles.match(/\.ua-categories button\s*\{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row, /grid-template-columns: 34px minmax\(0, 1fr\) 12px/);
  assert.match(row, /gap: 12px/);
  assert.match(styles, /\.ua-creator \.ua-avatar\s*\{\s*width: 34px/);
  assert.match(styles, /\.ua-creator\s*\{[^}]*gap: 12px/);
  assert.match(styles, /\.ua-categories button > svg:first-child\s*\{\s*justify-self: center/);
});

test("detail pane and sheet share the 1024px boundary and aligned header grid", () => {
  assert.equal((source.match(/min-width: 1024px/g) ?? []).length, 2);
  assert.equal(source.includes("min-width: 1180px"), false);
  assert.ok(styles.includes("(min-width: 760px) and (max-width: 1023px)"));
  assert.match(styles, /\.ua-detail-top\s*\{\s*display: grid/);
  assert.match(styles, /\.ua-detail-top > :is\(\.ua-detail-heading, h2\)/);
  const header = source.slice(source.indexOf('<div className="ua-detail-top">'), source.indexOf('<div className="ua-detail-actions">'));
  assert.ok(header.includes('className="ua-detail-heading"'));
  assert.ok(header.includes('label="Close skill details"'));
  assert.ok(source.includes('title={`Open ${skill.name} details`}'));
  assert.ok(source.includes('<ChevronRight aria-hidden="true" />'));
  assert.equal((source.match(/aria-label="Go to Discover"/g) ?? []).length, 2);
});
