import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { candidateOrigin, candidatePageAllowed } from "../src/candidate/policy";
import { catalogInstallAction } from "../src/app/unified/public-install";
import { CatalogInstallIntentStore, CatalogInstallSetupSession, CATALOG_INSTALL_INTENT_KEY,
  CANDIDATE_CATALOG_INSTALL_INTENT_KEY } from "../src/app/unified/catalog-install-intent";
import { INSTALL_INTENT_TTL } from "../src/app/unified/install-intent";
import { candidateDistribution } from "../src/candidate/distribution";
import type { SkillDisplay } from "../src/app/unified/model";

const skill: SkillDisplay = { key: "catalog:example/repo", catalogId: "example/repo", name: "skill", author: "example",
  description: "", tags: [], githubUrl: null };
const route = `/app/?view=discover&skill=${encodeURIComponent(skill.key)}`;
function disk() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function fixture(storage = disk(), agent: "claude" | "codex" = "codex", now = () => 1800000000000,
  refresh: (id: string, signal: AbortSignal) => Promise<SkillDisplay | null> = async () => skill) {
  const store = new CatalogInstallIntentStore(() => storage, "candidate"), opens: string[] = [];
  const session = new CatalogInstallSetupSession({ catalogId: skill.catalogId!, agent, returnRoute: route, store,
    now, refresh, open: href => { opens.push(href); } });
  return { store, session, opens, storage };
}

test("only the exact private candidate origin and normal app route can activate", () => {
  assert.ok(candidatePageAllowed(candidateOrigin, "/app/", ""));
  for (const origin of ["https://omgskills.com", "http://localhost:5199", candidateOrigin + ".evil.test", "http://omgskills-setup-test-f3b.netlify.app"])
    assert.equal(candidatePageAllowed(origin, "/app/", ""), false);
  for (const route of ["/", "/app/connect", "/app/preview/unified/", "/app/index.html"])
    assert.equal(candidatePageAllowed(candidateOrigin, route, ""), false);
  assert.equal(candidatePageAllowed(candidateOrigin, "/app/", "#install"), false);
});

test("both targets use the native product contract, not either historical test handler", () => {
  for (const agent of ["claude", "codex"] as const) for (const change of [{}, { hasPinnedInstall: true }, { skillMDPath: "aliases/SKILL.md" }]) {
    const link = new URL(catalogInstallAction({ ...skill, ...change }, agent, "candidate").href!);
    assert.equal(link.protocol, "omgskills:"); assert.equal(link.host, "catalog-install");
    assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: skill.catalogId, agent });
  }
  assert.equal(new URL(catalogInstallAction(skill, "codex").href!).protocol, "omgskills-f1:");
  const native = readFileSync(new URL("../../menubar/Sources/omgskills/CatalogCandidateRuntime.swift", import.meta.url), "utf8");
  assert.ok(native.includes(candidateOrigin)); assert.ok(native.includes('static let bundleID = "com.jonslimak.omgskills"'));
});

test("candidate requests do not adopt, overwrite or clear F1 setup requests", async () => {
  const storage = disk(), old = new CatalogInstallIntentStore(() => storage);
  const intent = { version: 1 as const, catalogId: skill.catalogId!, agent: "claude" as const, returnRoute: route, createdAt: 1800000000000 };
  old.save(intent);
  const f = fixture(storage);
  assert.equal(f.store.read().intent, null);
  f.session.showSetup(skill);
  assert.ok(storage.values.has(CANDIDATE_CATALOG_INSTALL_INTENT_KEY));
  assert.equal(storage.getItem(CATALOG_INSTALL_INTENT_KEY), JSON.stringify(intent));
  const reloaded = fixture(storage);
  assert.equal(reloaded.session.getSnapshot().phase, "setup"); assert.deepEqual(reloaded.opens, []);
  await reloaded.session.retry(); assert.deepEqual(reloaded.opens, []);
  reloaded.session.open(skill); reloaded.session.open(skill);
  assert.deepEqual(reloaded.opens, [catalogInstallAction(skill, "codex", "candidate").href]);
  assert.match(reloaded.session.getSnapshot().message, /^Opening requested.*OMGSkills Candidate/);
  assert.doesNotMatch(reloaded.session.getSnapshot().message, /Installed|F1|Setup Test/);
  reloaded.session.reset();
  assert.equal(storage.getItem(CANDIDATE_CATALOG_INSTALL_INTENT_KEY), null);
  assert.equal(storage.getItem(CATALOG_INSTALL_INTENT_KEY), JSON.stringify(intent));
});

test("candidate retry refuses target changes, expiry and missing catalog entries", async () => {
  const f = fixture(); f.session.showSetup(skill);
  assert.ok(fixture(f.storage, "claude").session.getSnapshot().restartRequired);
  assert.ok(fixture(f.storage, "codex", () => 1800000000000 + INSTALL_INTENT_TTL).session.getSnapshot().restartRequired);
  const unavailable = fixture(f.storage, "codex", undefined, async () => null);
  await unavailable.session.retry();
  assert.ok(unavailable.session.getSnapshot().restartRequired); assert.deepEqual(unavailable.opens, []);
});

test("candidate cancel and interrupted checks never produce a native handoff", async () => {
  let finish!: (skill: SkillDisplay) => void;
  const f = fixture(disk(), "codex", undefined, () => new Promise(resolve => { finish = resolve; }));
  f.session.showSetup(skill); const pending = f.session.retry(); f.session.reset(); finish(skill); await pending;
  assert.equal(f.session.getSnapshot().phase, "idle"); assert.deepEqual(f.opens, []);
});

test("setup never offers the old app or a nonexistent signed download", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/CatalogInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { CatalogInstallSetup: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const f = fixture(disk(), "codex", Date.now); f.session.showSetup(skill);
  const html = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, {
    skill, detailReady: true, returnRoute: route, store: f.store,
  }));
  assert.match(html, /signed candidate download is not available/);
  assert.match(html, /disposable Mac VM/); assert.match(html, /Try opening again/);
  assert.doesNotMatch(html, /href=|\.zip|\.dmg|OMGSkills F1 Test|OMGSkills Setup Test/);
  assert.match(html, /disabled=""[^>]*><svg[^]*Download for Mac/);
});

test("only the candidate can offer verified bootstrap A without changing the saved request", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/CatalogInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { CatalogInstallSetup: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const agent of ["claude", "codex"] as const) {
    const f = fixture(disk(), agent, Date.now); f.session.showSetup(skill);
    const before = f.storage.getItem(CANDIDATE_CATALOG_INSTALL_INTENT_KEY);
    const html = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, {
      skill, detailReady: true, returnRoute: route, store: f.store, distribution: candidateDistribution,
    }));
    assert.ok(html.includes(candidateDistribution.url)); assert.ok(html.includes(candidateDistribution.filename));
    assert.match(html, /Candidate 0\.0\.21 \(build 21\)/); assert.match(html, /~\/Applications/);
    assert.match(html, /Download test candidate 0\.0\.21/);
    assert.match(html, /double-click[^]*in Finder to extract it/);
    assert.match(html, /Using Finder, drag[^]*omgskills\.app[^]*into/);
    assert.match(html, /Do not open it from Downloads or the extracted folder/);
    assert.match(html, /Open <strong>omgskills\.app<\/strong> from <strong>~\/Applications/);
    assert.match(html, /public app&#x27;s identity/);
    assert.match(html, /never alongside or over your normal Mac app/);
    assert.doesNotMatch(html, /signed candidate download is not available|0\.0\.22|OMGSkills Setup Test/);
    assert.equal(f.storage.getItem(CANDIDATE_CATALOG_INSTALL_INTENT_KEY), before); assert.deepEqual(f.opens, []);
  }
  const oldStore = new CatalogInstallIntentStore(() => disk());
  const oldSession = new CatalogInstallSetupSession({ catalogId: skill.catalogId!, agent: "codex", returnRoute: route,
    store: oldStore, refresh: async () => skill, open: () => assert.fail("Unexpected handoff") });
  oldSession.showSetup(skill);
  const old = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, {
    skill, detailReady: true, returnRoute: route, store: oldStore, distribution: candidateDistribution,
  }));
  assert.doesNotMatch(old, /href=|0\.0\.21|\.zip/);
});
