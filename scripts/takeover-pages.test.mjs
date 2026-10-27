import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addTakeover, appShellTags, takeoverGuardStyle, takeoverPilotEnabled, takeoverPilotPages, writeTakeoverPilot } from "./takeover-pages.mjs";

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
