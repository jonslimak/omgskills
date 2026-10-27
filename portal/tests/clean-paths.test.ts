import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  catalogSkillPath,
  initialNavigation,
  navigationLocation,
  parsePublicNavigationPath,
  publicNavigationPath,
  type Navigation,
} from "../src/app/unified/model";
import { entryNavigation, staticPageAddress } from "../src/integration/unified/entry-navigation";
import { accountNavigation } from "../src/integration/unified/policy";

const nav = (value: Partial<Navigation>): Navigation => ({ ...initialNavigation, view: "discover", ...value });
const roundTrip = (value: Navigation) => {
  const location = publicNavigationPath(value);
  assert.ok(location, JSON.stringify(value));
  const [path, search = ""] = location.split("?");
  return { location, parsed: parsePublicNavigationPath(path, search ? `?${search}` : "") };
};

test("public views get clean addresses that read back to the same view", () => {
  const cases: [Partial<Navigation>, string][] = [
    [{}, "library/"],
    [{ query: "design system" }, "library/?q=design+system"],
    [{ query: "design", sort: "stars" }, "library/?q=design&sort=stars"],
    [{ view: "top" }, "library/trending/"],
    [{ view: "data" }, "library/data/"],
    [{ view: "creators" }, "library/creators/"],
    [{ view: "creators", id: "companies" }, "library/companies/"],
    [{ view: "collections" }, "library/collections/"],
    [{ view: "collection", id: "design-essentials" }, "library/collections/design-essentials/"],
    [{ view: "creator", id: "anthropics" }, "library/anthropics/"],
    [{ view: "creator", id: "anthropics", sort: "updated" }, "library/anthropics/?sort=updated"],
  ];
  for (const [value, expected] of cases) {
    const { location, parsed } = roundTrip(nav(value));
    assert.equal(location, expected);
    assert.deepEqual(parsed, nav(value), expected);
  }
});

test("a public skill address opens its creator with that skill selected, including nested and root IDs", () => {
  const cases: [string, string][] = [
    ["anthropics/skills:skills/frontend-design", "library/anthropics/skills/skills/frontend-design/"],
    ["mvanhorn/last30days-skill", "library/mvanhorn/last30days-skill/"],
    ["DietrichGebert/ponytail:ponytail", "library/DietrichGebert/ponytail/ponytail/"],
    ["owner/repo:dir with space/skill:v2", "library/owner/repo/dir%20with%20space/skill%3Av2/"],
  ];
  for (const [id, expected] of cases) {
    const { location, parsed } = roundTrip(nav({ query: "design", selected: `catalog:${id}` }));
    assert.equal(location, expected);
    assert.equal(parsed?.selected, `catalog:${id}`);
    assert.equal(parsed?.view, "creator");
    assert.equal(parsed?.id, id.split("/")[0].toLowerCase());
  }
});

test("private views, private selections, filters and unsafe IDs keep the ?view= form", () => {
  for (const value of [
    nav({ view: "all" }), nav({ view: "favorites" }), nav({ view: "set", id: "abc" }), nav({ view: "devices" }),
    nav({ selected: "synced:123" }), nav({ view: "set", selected: "set-item:9" }), nav({ source: "codex" }),
    nav({ view: "creator", id: "trending" }), nav({ selected: "catalog:trending/repo:skill" }),
    nav({ selected: "catalog:owner/repo:a/../b" }), nav({ selected: "catalog:owner/repo:a//b" }),
    nav({ selected: "catalog:owner/repo:" }), nav({ view: "creator", id: "anthropics", query: "pdf" }),
  ]) {
    assert.equal(publicNavigationPath(value), null, JSON.stringify(value));
    assert.match(navigationLocation(value, true), /^\?view=/);
  }
  assert.equal(navigationLocation(nav({ view: "top" }), false), "?view=top");
});

test("malformed and reserved clean paths are not guessed", () => {
  for (const path of ["library/%E0%A4%A/", "library/a//b/", "library/a/../b/", "library/collections/a/b/", "librarything/", "skills/x/"]) {
    assert.equal(parsePublicNavigationPath(path, ""), null, path);
  }
});

test("entry reads clean paths, old ?view= links and legacy path routes", () => {
  assert.deepEqual(entryNavigation("/app/library/anthropics/", "", "/app/"), nav({ view: "creator", id: "anthropics" }));
  assert.equal(entryNavigation("/app/", "?view=discover&skill=catalog%3Aobra%2Fsuperpowers%3Abrainstorming", "/app/").selected,
    "catalog:obra/superpowers:brainstorming");
  assert.deepEqual(entryNavigation("/app/groups/abc", "", "/app/"), { ...initialNavigation, view: "set", id: "abc" });
  assert.deepEqual(entryNavigation("/app/", "", "/app/"), nav({}));
  // A taken-over static page keeps its root /library/... address.
  assert.deepEqual(entryNavigation("/library/anthropics/", "", "/app/"), nav({ view: "creator", id: "anthropics" }));
  assert.equal(entryNavigation("/library/anthropics/skills/skills/frontend-design/", "", "/app/").selected,
    "catalog:anthropics/skills:skills/frontend-design");
  // The taken-over homepage is Discover and keeps "/"; app.omgskills.com's own root does not.
  assert.deepEqual(entryNavigation("/", "", "/app/"), nav({ view: "discover" }));
  assert.equal(staticPageAddress("/", "/app/"), true);
  assert.equal(staticPageAddress("/", "/"), false);
  assert.equal(staticPageAddress("/library/anthropics/", "/app/"), true);
});

test("signed-out public entries rewrite old links without rewriting private destinations", () => {
  const session = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(session, /if \(!\(available \|\| isDiscovery\(requested\.view\)\)\) return;/);
  assert.match(session, /history\.replaceState\(\{ nav \}, "", keep \? here : current\)/);
  const cases: [string, string][] = [
    ["?view=creator&id=anthropics&sort=stars", "library/anthropics/?sort=stars"],
    ["?view=collection&id=starter-pack", "library/collections/starter-pack/"],
    ["?view=top", "library/trending/"],
    ["?view=data", "library/data/"],
    ["?view=creators", "library/creators/"],
    ["?view=creators&id=companies", "library/companies/"],
    ["?view=collections", "library/collections/"],
    ["?view=creator&id=anthropics&skill=catalog%3Aanthropics%2Fskills%3Apptx", "library/anthropics/skills/pptx/"],
  ];
  for (const [search, expected] of cases) {
    const requested = entryNavigation("/app/", search, "/app/");
    const safe = accountNavigation(requested, false);
    assert.deepEqual(safe, requested);
    assert.equal(navigationLocation(safe, true), expected);
  }
  for (const search of ["?view=set&id=private&skill=set-item%3Asecret", "?view=all&skill=synced%3Asecret", "?view=devices"]) {
    const requested = entryNavigation("/app/", search, "/app/");
    assert.equal(publicNavigationPath(requested), null);
    assert.deepEqual(accountNavigation(requested, false), nav({}));
  }
  assert.match(session, /clerk\.openSignIn\(\{ forceRedirectUrl: returnUrl \}\)/);
  assert.match(session, /clerk\.signOut\(\{ redirectUrl: `\$\{base\}\$\{navigationSearch\(next\)\}` \}\)/);
});

const manifestUrl = new URL("../../site/data/crawl4/manifest.json", import.meta.url);
test("every public catalog ID round-trips through its address or keeps the ?view= form", { skip: !existsSync(manifestUrl) }, () => {
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  const skills: { id: string }[] = JSON.parse(readFileSync(new URL(`../../site/data/crawl4/${manifest.skills.path}`, import.meta.url), "utf8"));
  let fallbacks = 0;
  for (const { id } of skills) {
    const path = catalogSkillPath(id);
    if (!path) { fallbacks++; continue; }
    // The browser must not rewrite the path (dot segments, backslashes, encoding).
    assert.equal(new URL(`/app/${path}`, "https://omgskills.com").pathname, `/app/${path}`, id);
    assert.equal(parsePublicNavigationPath(path, "")?.selected, `catalog:${id}`, id);
  }
  assert.ok(skills.length > 1000);
  assert.ok(fallbacks / skills.length < 0.001, `${fallbacks} of ${skills.length} IDs need the ?view= form`);
});

test("only addresses nothing recognizes count as unknown", async () => {
  const { unknownAppAddress } = await import("../src/integration/unified/entry-navigation");
  for (const known of ["/app/", "/app/library/", "/app/library/nobody-xyz/", "/app/library/a/b/c/", "/app/groups/abc", "/app/agents", "/app/home"]) {
    assert.equal(unknownAppAddress(known, "/app/"), false, known);
  }
  for (const unknown of ["/app/library/a//b/", "/app/whatever", "/app/library/collections/a/b/"]) {
    assert.equal(unknownAppAddress(unknown, "/app/"), true, unknown);
  }
  assert.equal(unknownAppAddress("/library/anthropics/", "/app/"), false, "outside the app base");
});
