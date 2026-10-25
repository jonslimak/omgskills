import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCreatorProfiles, createCreatorProfileLoader } from "../src/app/unified/creator-profiles";
import { CreatorProfileLinks, CreatorProfileText } from "../src/app/unified/CreatorProfileDetails";

const source = { version: 1, profiles: { anthropics: { description: "Official skills for documents, frontend work, testing, and Claude API tasks.",
  githubUrl: "https://github.com/anthropics", skillCount: 395, totalStars: 15681887, totalInstalls: 2046054,
  bestSkill: { id: "anthropics/skills:pptx", name: "pptx" }, rankings: [
    { category: "influential", rank: 1, value: "15.7M stars" }, { category: "most-used", rank: 6, value: "2.0M installs" },
    { category: "peak", rank: 9, value: "182.1k stars" },
  ] } } };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("the planned creator expansion loads beyond the old count and byte limits", async () => {
  const profiles = Object.fromEntries(Array.from({ length: 675 }, (_, i) => [`creator-${i}`, { description: "d".repeat(500), rankings: [] }]));
  const value = { version: 1, profiles };
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 250_000);
  const loaded = await createCreatorProfileLoader(async () => json(value))();
  assert.equal(Object.keys(loaded).length, 675);
  assert.equal(Object.keys(parseCreatorProfiles({ version: 1, profiles: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`creator-${i}`, {}])) })).length, 1000);
  assert.throws(() => parseCreatorProfiles({ version: 1, profiles: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`creator-${i}`, {}])) }), /too large/);
});

test("creator banner renders published totals and rank labels without best skill or ranking counts", () => {
  const profile = parseCreatorProfiles(source).anthropics;
  const html = renderToStaticMarkup(createElement(CreatorProfileText, { profile }));
  for (const text of [profile.description, "<strong>15.7M</strong> Stars", "<strong>395</strong> Skills", "<strong>2M</strong> Installs",
    "<strong>Influential #1</strong>", "<strong>Most-used #6</strong>", "<strong>Peak #9</strong>"]) assert.ok(html.includes(text), text);
  for (const badge of profile.rankings) assert.equal(html.includes(badge.value), false);
  assert.equal(profile.rankings[0].value, "15.7M stars");
  assert.ok(html.includes('class="ua-creator-profile-description"'));
  assert.ok(html.includes('class="ua-creator-profile-details"'));
  assert.ok(html.includes('class="ua-creator-profile-rankings"'));
  assert.ok(html.includes('aria-label="Creator statistics"'));
  assert.ok(html.indexOf("</strong> Stars") < html.indexOf("</strong> Skills"));
  assert.ok(html.indexOf("</strong> Skills") < html.indexOf("</strong> Installs"));
  assert.equal(html.includes("Best skill"), false);
  assert.equal(html.includes("pptx"), false);
  assert.equal(profile.bestSkill?.name, "pptx");
  assert.equal(html.includes('aria-label="View on GitHub"'), false);
  assert.equal(html.includes('>https://github.com/anthropics<'), false);
  assert.equal(html.includes('GitHub: '), false);
});

test("social links sit beside the short description and use matching icon sizes", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(app.includes('<p className="ua-creator-tagline">{meta && <span>{meta}</span>}<CreatorSocialLinks handle={nav.id} /></p>'));
  const profile = { ...parseCreatorProfiles(source).anthropics, xUrl: "https://x.com/AnthropicAI" };
  const links = renderToStaticMarkup(createElement(CreatorProfileLinks, { profile }));
  for (const [label, href, icon] of [["GitHub", profile.githubUrl, "github"], ["X", profile.xUrl, "x"]]) {
    assert.ok(links.includes(`href="${href}"`));
    assert.ok(links.includes(`aria-label="View on ${label}"`));
    assert.ok(links.includes(`title="View on ${label}"`));
    assert.ok(links.includes(`class="ua-creator-${icon}-mark"`));
  }
  assert.ok(links.indexOf('View on GitHub') < links.indexOf('View on X'));
  assert.equal(links.includes('>X<'), false);
  const text = renderToStaticMarkup(createElement(CreatorProfileText, { profile }));
  assert.equal(text.includes('View on X'), false);
  const githubOnly = renderToStaticMarkup(createElement(CreatorProfileLinks, { profile: { ...profile, xUrl: undefined } }));
  assert.equal(githubOnly.includes('View on X'), false);
  assert.equal(renderToStaticMarkup(createElement(CreatorProfileLinks, { profile: { rankings: [] } })), "");
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(css, /\.ua-creator-github-mark,\s*\.ua-creator-x-mark \{\s*width: 14\.4px;\s*height: 14\.4px;/);
  const svg = readFileSync(new URL("../src/app/unified/icons/github.svg", import.meta.url), "utf8");
  assert.equal((svg.match(/<path\b/g) || []).length, 1);
  assert.equal(svg.includes('fill="#fff"'), false);
});

test("malformed optional fields cannot create unsafe links, false totals, or missing-profile crashes", () => {
  const profile = parseCreatorProfiles({ version: 1, profiles: { author: { description: "<script>text</script>",
    githubUrl: "javascript:alert(1)", xUrl: "https://evil.example/user", totalStars: -1, skillCount: 0, rankings: [{ category: "unknown", rank: 1, value: "bad" }] } } });
  assert.equal(profile.constructor, undefined);
  assert.equal(profile.author.githubUrl, undefined);
  assert.equal(profile.author.xUrl, undefined);
  assert.equal(profile.author.totalStars, undefined);
  assert.equal(profile.author.skillCount, 0);
  const html = renderToStaticMarkup(createElement(CreatorProfileText, { profile: profile.author }));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>0</strong> Skills"));
  assert.equal(html.includes(" Stars"), false);
  assert.equal(html.includes('class="ua-creator-profile-rankings"'), false);
  assert.equal(html.includes(" Installs"), false);
  assert.equal(html.includes("<script>"), false);
  assert.throws(() => parseCreatorProfiles({ version: 2, profiles: {} }));
});

test("creators without published totals or rankings do not render empty statistic groups", () => {
  const html = renderToStaticMarkup(createElement(CreatorProfileText, { profile: { description: "", rankings: [] } }));
  assert.equal(html.includes('aria-label="Creator statistics"'), false);
  assert.equal(html.includes('class="ua-creator-profile-rankings"'), false);
});

test("zero installs leave only the other statistics and no empty install group", () => {
  for (const totalInstalls of [0, undefined]) {
    const profile = { ...parseCreatorProfiles(source).anthropics, totalInstalls };
    const html = renderToStaticMarkup(createElement(CreatorProfileText, { profile }));
    assert.ok(html.includes("</strong> Stars"));
    assert.ok(html.includes("</strong> Skills"));
    assert.equal(html.includes(" Installs"), false);
    assert.equal((html.match(/<span>/g) || []).length, 2);
  }
  const html = renderToStaticMarkup(createElement(CreatorProfileText, { profile: { totalInstalls: 0, rankings: [] } }));
  assert.equal(html.includes('aria-label="Creator statistics"'), false);
});

test("profile feeds omit repeated authors without hiding them in search or other feeds", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.ok(app.includes('const creatorHeader = nav.view === "creator" && !nav.query;'));
  assert.ok(app.includes('!compact && !creatorHeader && (discovery || nav.query) && skill.author'));
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(css, /\.ua-creator-profile-stats\s*\{[^}]*justify-content: flex-end/);
  assert.match(css, /@container \(max-width: 850px\)[\s\S]*?\.ua-creator-profile-stats\s*\{[^}]*grid-column: 2;[^}]*justify-self: start;[^}]*justify-content: flex-start/);
  assert.match(css, /\.ua-creator-profile-stats > span \+ span::before/);
});

test("summary loads once, is read-only and independent of public catalog requests, and expires", async () => {
  let reads = 0, now = 0;
  const loader = createCreatorProfileLoader(async (url, init) => {
    reads++;
    assert.equal(url, "/app/creator-profiles.json");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.body, undefined);
    return json(source);
  }, () => now);
  const [a, b] = await Promise.all([loader(), loader()]);
  assert.equal(a, b);
  assert.equal(reads, 1);
  await loader();
  assert.equal(reads, 1);
  now = 600_001;
  await loader();
  assert.equal(reads, 2);
});

test("failed or oversized summaries can retry without blocking the ordinary skill list", async () => {
  let reads = 0;
  const loader = createCreatorProfileLoader(async () => ++reads === 1 ? new Response("Missing", { status: 404 }) : json(source));
  await assert.rejects(loader(), /unavailable/);
  assert.equal((await loader()).anthropics.skillCount, 395);
  const oversized = createCreatorProfileLoader(async () => new Response(" ".repeat(1_000_001), { headers: { "content-type": "application/json" } }));
  await assert.rejects(oversized(), /too large/);
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  const banner = app.slice(app.indexOf('<header className="ua-creator-banner">'), app.indexOf('</header>', app.indexOf('<header className="ua-creator-banner">')));
  assert.ok(banner.includes('<CreatorProfileDetails handle={nav.id} />'));
  const catalog = readFileSync(new URL("../src/app/unified/public-catalog.ts", import.meta.url), "utf8");
  assert.equal(catalog.includes("creator-profiles.json"), false);
});
