import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addTakeover, appShellTags, librarySkillPath, takeoverAllPagesEnabled, takeoverGuardStyle, takeoverLoader, takeoverLoaderPath, takeoverPilotEnabled, takeoverPilotPages, writeTakeover, writeTakeoverPilot } from "./takeover-pages.mjs";

const shell = `<!doctype html><html><head><title>omgskills</title>
<script type="module" crossorigin src="/app/assets/index-abc.js"></script>
<link rel="stylesheet" crossorigin href="/app/assets/index-def.css"></head><body><div id="root"></div></body></html>`;
const page = `<!doctype html>\n<html lang="en">\n<head>\n  <title>Anthropic</title>\n  <link rel="canonical" href="https://omgskills.com/skills/a/">\n  <style>\n    main { max-width: 880px; }\n  </style>\n</head>\n<body>\n  <main><h1>Anthropic</h1></main>\n  <script>window.copy = 1;</script>\n</body>\n</html>\n`;

test("the pilot is off unless explicitly enabled", () => {
  assert.equal(takeoverPilotEnabled({}), false);
  assert.equal(takeoverPilotEnabled({ PORTAL_TAKEOVER_PILOT: "true" }), false);
  assert.equal(takeoverPilotEnabled({ PORTAL_TAKEOVER_PILOT: "1" }), true);
  assert.equal(takeoverPilotEnabled({}, { takeoverPilotEnabled: true }), true, "reviewed production setting");
  assert.equal(takeoverPilotEnabled({}, { takeoverPilotEnabled: false }), false);
  assert.equal(takeoverPilotEnabled({ PORTAL_TAKEOVER_PILOT: "0" }, { takeoverPilotEnabled: true }), false, "local override off");
  assert.equal(takeoverAllPagesEnabled({}, { takeoverPilotEnabled: true, takeoverAllPagesEnabled: true }), true);
  assert.equal(takeoverAllPagesEnabled({}, { takeoverAllPagesEnabled: true }), false, "needs the pilot");
  assert.equal(takeoverAllPagesEnabled({ PORTAL_TAKEOVER_ALL: "0" }, { takeoverPilotEnabled: true, takeoverAllPagesEnabled: true }), false);
});

test("a static page keeps its content and metadata, gains the app, and marks its own styles", () => {
  const html = addTakeover(page, appShellTags(shell));
  assert.match(html, /<link rel="canonical" href="https:\/\/omgskills.com\/skills\/a\/">/, "canonical unchanged");
  assert.match(html, /<style data-omgskills-static>\n    main \{ max-width: 880px; \}/);
  assert.ok(html.includes(`<style data-omgskills-static>${takeoverGuardStyle}</style>`));
  assert.ok(html.indexOf('src="/app/assets/index-abc.js"') < html.indexOf("</head>"));
  assert.ok(html.indexOf('href="/app/assets/index-def.css"') < html.indexOf("</head>"));
  assert.match(html, /<div id="omgskills-static">\n  <main><h1>Anthropic<\/h1><\/main>\n  <script>window.copy = 1;<\/script>\n<\/div>\n<div id="root" hidden><\/div>\n<\/body>/);
  assert.throws(() => addTakeover(html, appShellTags(shell)), /already converted/);
  assert.throws(() => appShellTags("<html></html>"), /entry script not found/);
});

test("the pilot writes only the pilot pages from their static sources", async t => {
  const out = await mkdtemp(path.join(os.tmpdir(), "takeover-pilot-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  await mkdir(path.join(out, "app"), { recursive: true });
  await writeFile(path.join(out, "app", "index.html"), shell);
  for (const { source } of takeoverPilotPages) {
    await mkdir(path.join(out, source), { recursive: true });
    await writeFile(path.join(out, source, "index.html"), page);
  }
  assert.deepEqual(await writeTakeoverPilot(out), takeoverPilotPages.map(p => p.url));
  for (const { url } of takeoverPilotPages) assert.match(await readFile(path.join(out, url, "index.html"), "utf8"), /id="omgskills-static"/);
  assert.equal(await readFile(path.join(out, "skills/anthropics/skills/skills/frontend-design/index.html"), "utf8"), page, "source pages unchanged");
});

test("pages load the app through the fixed loader, which adds the current stylesheet and entry", () => {
  const html = addTakeover(page);
  assert.ok(html.includes(`<script defer src="${takeoverLoaderPath}"></script>`));
  assert.doesNotMatch(html, /\/app\/assets\//, "page bytes do not change when the app does");
  const loader = takeoverLoader(appShellTags(shell));
  assert.match(loader, /\["\/app\/assets\/index-def\.css"\]/);
  assert.match(loader, /\["\/app\/assets\/index-abc\.js"\]/);
  assert.match(loader, /script\.type = "module"/);
  assert.throws(() => takeoverLoader(['<script type="module" src="https://evil.test/x.js"></script>']), /unexpected/);
});

test("library skill addresses match the app mapping, including reserved owners and encoded parts", () => {
  assert.equal(librarySkillPath("anthropics/skills:skills/frontend-design"), "/library/anthropics/skills/skills/frontend-design/");
  assert.equal(librarySkillPath("abpframework/abp:.claude/skills/abp-angular"), "/library/abpframework/abp/.claude/skills/abp-angular/");
  assert.equal(librarySkillPath("n8n-io/n8n:packages/@n8n/x"), "/library/n8n-io/n8n/packages/%40n8n/x/");
  assert.equal(librarySkillPath("trending/repo:skill"), null);
  assert.equal(librarySkillPath("owner/repo:../x"), null);
  assert.equal(librarySkillPath("owner/repo:"), null);
});

test("all pages: every creator page in place, each skill at its /library/ address, case clashes once", async t => {
  const out = await mkdtemp(path.join(os.tmpdir(), "takeover-all-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const write = async (dir, html = page) => { await mkdir(path.join(out, dir), { recursive: true }); await writeFile(path.join(out, dir, "index.html"), html); };
  await mkdir(path.join(out, "app"), { recursive: true });
  await writeFile(path.join(out, "app", "index.html"), shell);
  await write("developers"); await write("library/anthropics"); await write("library/othmanadi");
  await write("skills/a"); await write("skills/b"); await write("skills/c"); await write("skills/d");
  await writeFile(path.join(out, "catalog-skill-urls.json"), JSON.stringify({ version: 1, skills: {
    "anthropics/skills:skills/frontend-design": "/skills/a/",
    "othmanadi/planning-with-files:planning-with-files": "/skills/b/",
    "OthmanAdi/planning-with-files:planning-with-files": "/skills/c/",
    "n8n-io/n8n:packages/@n8n/x": "/skills/d/",
    "abpframework/abp:.claude/skills/abp-angular": "/skills/a/",
  } }));
  const { urls, skipped } = await writeTakeover(out, { all: true });
  assert.deepEqual(urls, ["/developers/", "/library/anthropics/", "/library/othmanadi/",
    "/library/anthropics/skills/skills/frontend-design/", "/library/othmanadi/planning-with-files/planning-with-files/",
    "/library/n8n-io/n8n/packages/@n8n/x/"]);
  assert.deepEqual(skipped, ["OthmanAdi/planning-with-files:planning-with-files", "abpframework/abp:.claude/skills/abp-angular"]);
  assert.match(await readFile(path.join(out, "library/n8n-io/n8n/packages/@n8n/x/index.html"), "utf8"), /id="omgskills-static"/);
  assert.match(await readFile(path.join(out, "app/takeover.js"), "utf8"), /index-abc\.js/);
  assert.equal(await readFile(path.join(out, "skills/a/index.html"), "utf8"), page, "source pages unchanged");
});
