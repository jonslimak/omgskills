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
