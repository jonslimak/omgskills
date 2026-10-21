import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initialNavigation,
  navigationSearch,
  parseNavigation,
  skillDisplays,
  matchesSearch,
  isFavorite,
  discoverCollectionPage,
  type CatalogDisplay,
} from "../src/app/unified/model";
import { makeFixtures } from "../src/preview/fixtures";
import { isLocalPreview } from "../src/app/preview-gate";

const catalog: CatalogDisplay = {
  skills: [
    {
      id: "anthropics/skills:frontend-design",
      name: "frontend-design",
      description: "Public description",
      author: "anthropics",
      githubUrl: "https://github.com/anthropics/skills",
      tags: ["Design"],
    },
  ],
  creators: [],
  collections: [],
  categories: [],
  trendingIds: [],
};

test("Discover pages collections in ordered groups of three without changing the full list", () => {
  const collections: CatalogDisplay["collections"] = Array.from({ length: 18 }, (_, i) => ({
    id: `collection-${i}`, name: `Collection ${i}`, description: "", skillIds: [],
  }));
  const pages = Array.from({ length: 6 }, (_, i) => discoverCollectionPage(collections, i));
  assert.deepEqual(pages.map(page => page.items.length), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual(pages.flatMap(page => page.items), collections);
  assert.deepEqual(pages.map(page => [page.index, page.lastIndex, page.start, page.end]), [
    [0, 5, 1, 3], [1, 5, 4, 6], [2, 5, 7, 9], [3, 5, 10, 12], [4, 5, 13, 15], [5, 5, 16, 18],
  ]);
  assert.equal(collections.length, 18);
  assert.deepEqual(discoverCollectionPage(collections, -1), pages[0]);
  assert.deepEqual(discoverCollectionPage(collections, 6), pages[5]);
});

test("Discover collection paging handles empty, single-page, partial, and refreshed lists", () => {
  assert.deepEqual(discoverCollectionPage([], 5), { index: 0, lastIndex: 0, items: [], start: 0, end: 0 });
  for (const count of [1, 2, 3, 4, 5]) {
    const collections: CatalogDisplay["collections"] = Array.from({ length: count }, (_, i) => ({
      id: `${i}`, name: `${i}`, description: "", skillIds: [],
    }));
    const last = discoverCollectionPage(collections, 5);
    assert.equal(last.index, count > 3 ? 1 : 0);
    assert.equal(last.end, count);
    assert.deepEqual(last.items, collections.slice(count > 3 ? 3 : 0));
  }
});

test("collection arrows stay scoped to Discover while Collections remains unpaged", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('const showCollectionPager = nav.view === "discover" && !nav.query;'));
  assert.ok(source.includes('label="Previous collections"'));
  assert.ok(source.includes('label="Next collections"'));
  assert.ok(source.includes('disabled={!collectionsReady || collectionPage.index === 0}'));
  assert.ok(source.includes('disabled={!collectionsReady || collectionPage.index === collectionPage.lastIndex}'));
  assert.ok(source.includes('CollectionCards({ items: swipeCollections ? catalog.collections : collectionPage.items, swipe: swipeCollections })'));
  // Phones swipe through every collection; the arrows only page on larger screens.
  assert.ok(source.includes('const swipeCollections = showCollectionPager && phone;'));
  assert.ok(source.includes('{showCollectionPager && !swipeCollections && ('));
  assert.match(source, /nav.view === "collections" \? \(\s*CollectionCards\(\{\}\)/);
});

test("creator banners stay scoped to profiles, use existing identity data and replace the standalone back link", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('const creatorHeader = nav.view === "creator" && !nav.query;'));
  assert.ok(source.includes('!collectionHeader && !creatorHeader &&'));
  const banner = source.slice(source.indexOf('<header className="ua-creator-banner">'));
  const markup = banner.slice(0, banner.indexOf('</header>'));
  assert.match(markup, /onClick=\{\(\) => go\("discover"\)\}/);
  assert.ok(markup.includes('name={title}'));
  assert.ok(markup.includes('src={creator?.avatar || library.find((skill) => skill.author === nav.id)?.avatar}'));
  assert.ok(markup.includes('<h1>{title}</h1>'));
  assert.ok(markup.includes('<p className="ua-creator-tagline">{meta && <span>{meta}</span>}<CreatorSocialLinks handle={nav.id} /></p>'));
  assert.equal(markup.includes('CollectionCover'), false);
});

test("unified preview retains development, opt-in, loopback and preview route restrictions", () => {
  const input = {
    development: true,
    enabled: "1",
    hostname: "127.0.0.1",
    pathname: "/app/preview/unified/",
  };
  assert.equal(isLocalPreview(input), true);
  for (const change of [
    { development: false },
    { enabled: undefined },
    { hostname: "omgskills.com" },
    { pathname: "/app/connect" },
  ])
    assert.equal(isLocalPreview({ ...input, ...change }), false);
  const bootstrap = readFileSync(
    new URL("../src/bootstrap.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    bootstrap.indexOf("import.meta.env.DEV") <
      bootstrap.indexOf('import("./preview/unified/main")'),
  );
  assert.ok(bootstrap.includes('import("./preview/main")'));
});

test("navigation round-trips punctuation and IDs without using path fragments", () => {
  const nav = {
    ...initialNavigation,
    view: "creator" as const,
    id: "owner/name",
    selected: "catalog:owner/repo:some skill",
    query: "design & app #1",
    source: "Claude Code",
  };
  const search = navigationSearch(nav);
  assert.equal(search.includes("#"), false);
  assert.deepEqual(parseNavigation(search), nav);
  assert.deepEqual(parseNavigation(""), initialNavigation);
  assert.equal(parseNavigation("?view=connect").view, "all");
});

test("library installs match exact catalog ID, not names or repository URL", () => {
  const data = makeFixtures();
  const view = skillDisplays(data, catalog);
  assert.equal(view.library[0].installed?.catalogSkillId, catalog.skills[0].id);
  assert.equal(view.library[0].installed?.allSkillIds.length, 2);
  const other = {
    ...catalog,
    skills: [{ ...catalog.skills[0], id: "different/repo:frontend-design" }],
  };
  assert.equal(skillDisplays(data, other).library[0].installed, undefined);
});

test("local skills remain private and unassociated with public lookalikes", () => {
  const data = makeFixtures();
  const view = skillDisplays(data, {
    ...catalog,
    skills: [
      {
        ...catalog.skills[0],
        id: "someone/repo:landing-page",
        name: "landing-page",
      },
    ],
  });
  const local = view.mine.find((skill) => skill.name === "landing-page")!;
  assert.equal(local.catalogId, undefined);
  assert.equal(local.author, "");
  assert.equal(local.githubUrl, null);
  assert.equal(view.library[0].installed, undefined);
});

test("private search includes every grouped source without leaking into catalog display fields", () => {
  const data = makeFixtures();
  data.skills[0].description = "Distinctive private phrase";
  const { mine, library } = skillDisplays(data, catalog);
  assert.equal(
    mine.filter((skill) => matchesSearch(skill, "private phrase")).length,
    1,
  );
  assert.equal(library[0].description, "Public description");
});

test("favorites use physical synced identities and never favorite a catalog-only row", () => {
  const data = makeFixtures();
  const { mine, library } = skillDisplays(data, catalog);
  assert.equal(
    isFavorite(data, mine.find((skill) => skill.name === "brand-voice")!),
    true,
  );
  assert.equal(
    isFavorite(data, { ...library[0], installed: undefined }),
    false,
  );
});

test("new preview controller has no network, auth, persistent storage, or production action imports", () => {
  const source = readFileSync(
    new URL("../src/preview/unified/main.tsx", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "@clerk",
    "integration/",
  ])
    assert.equal(source.includes(forbidden), false, forbidden);
  assert.ok(source.includes("Local preview"));
  assert.ok(source.includes("sample data"));
});
