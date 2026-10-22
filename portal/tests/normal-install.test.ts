import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalInstallAction, normalInstallClient, developmentInstallLink } from "../src/app/unified/public-install";
import { InstallIntentStore, InstallSetupSession, INSTALL_INTENT_KEY, NORMAL_INSTALL_INTENT_KEY,
  INSTALL_INTENT_TTL, intentFromAction } from "../src/app/unified/install-intent";
import type { SkillDisplay } from "../src/app/unified/model";
import { setupTestDistribution } from "../src/app/unified/setup-test-distribution";

const now = 1_800_000_000_000;
const skill: SkillDisplay = { key: "catalog:example/tools:skills/novel", catalogId: "example/tools:skills/novel",
  name: "novel", description: "", author: "example", tags: [], githubUrl: "https://github.com/example/tools", skillMDPath: "skills/novel/SKILL.md" };
const route = `/app/?view=discover&skill=${encodeURIComponent(skill.key)}`;
const normalKey = `${NORMAL_INSTALL_INTENT_KEY}.setup-test`;
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function fixture({ disk = storage(), refresh = async () => skill, clock = () => now } = {}) {
  const store = new InstallIntentStore(() => disk, "setup-test", "normal");
  const opens: string[] = [];
  const session = new InstallSetupSession({ catalogId: skill.catalogId!, client: "setup-test", returnRoute: route, store,
    action: normalInstallAction, refresh, now: clock, open: href => { opens.push(href); } });
  return { store, session, disk, opens };
}

test("normal install is explicit, loopback-only, development-only and uses one fixed handler", () => {
  for (const host of ["localhost", "127.0.0.1"]) assert.equal(normalInstallClient(true, "1", host), "setup-test");
  for (const host of ["omgskills.com", "omgskills-setup-test-f3b.netlify.app", "localhost.evil.test", "127.0.0.2", ""]) {
    assert.equal(normalInstallClient(true, "1", host), null);
  }
  for (const flag of [undefined, null, false, true, 1, "true", "0", "omgskills"]) assert.equal(normalInstallClient(true, flag, "localhost"), null);
  assert.equal(normalInstallClient(false, "1", "localhost"), null);
  const bootstrap = readFileSync(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
  assert.match(bootstrap, /import.meta.env.DEV && location.pathname === "\/app\/" &&\s+\(normalInstallClient/);
  const session = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(session, /import.meta.env.DEV \? normalInstallClient/);
  assert.match(session, /!composition && installClient && base === "\/app\/"/);
  assert.match(session, /publicInstallAction=\{composition\?\.publicInstallAction \?\? \(installClient && installStore \?/);
  assert.match(session, /key=\{skill.key\}/);
  assert.doesNotMatch(session, /f2-install|f2Cases|f2case|VITE_NEWMAC_F1|VITE_NEWMAC_SETUP_TEST/);
});

test("normal requests accept new public IDs without fixtures, never convert catalog pins to latest", () => {
  const action = normalInstallAction(skill);
  assert.ok(action.href);
  const link = new URL(action.href);
  assert.equal(link.protocol, "omgskills-setup-test:");
  assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: skill.catalogId, repo: "example/tools", path: skill.skillMDPath, agent: "codex" });
  for (const change of [{ hasPinnedInstall: true }, { catalogId: undefined }, { key: "synced:private" }, { setItemKind: "catalog" as const },
    { skillMDPath: undefined }, { skillMDPath: "../SKILL.md" }, { githubUrl: "https://github.com/evil/repo?x=1" }]) {
    const denied = normalInstallAction({ ...skill, ...change });
    assert.equal(denied.href, null);
    assert.ok(denied.reason);
  }
});

test("normal intents accept only their own bounded route with one selected public skill", () => {
  const action = normalInstallAction(skill);
  assert.ok(intentFromAction(skill, action, route, now, "setup-test", "normal"));
  assert.equal(intentFromAction(skill, action, route, now, "setup-test"), null);
  for (const value of ["https://evil.test" + route, "//evil.test" + route, route + "#secret",
    route + "&f2case=humanizer-a", route + "&commit=" + "a".repeat(40), route + "&view=top",
    route + "&skill=" + encodeURIComponent(skill.key), route + "&q=%0A", route + "&source=x&source=y",
    route + "&redirect=https://evil.test", route.replace("/app/", "/app/preview/unified/"),
    route.replace("/app/", "/app/x/../"), route.replace("/app/", "/app/%2e/"), route.replace("/app/", "/app/connect/")]) {
    assert.equal(intentFromAction(skill, action, value, now, "setup-test", "normal"), null, value);
  }
});

test("normal setup survives reload, rechecks metadata and only opens after a new click", async () => {
  const first = fixture();
  first.session.showSetup(skill);
  assert.equal(first.opens.length, 0);
  const saved = JSON.parse(first.disk.getItem(normalKey)!);
  assert.equal(saved.commit, undefined);
  assert.equal(saved.returnRoute, route);
  const second = fixture({ disk: first.disk });
  assert.equal(second.session.getSnapshot().phase, "setup");
  await second.session.retry();
  assert.equal(second.session.getSnapshot().phase, "ready");
  assert.equal(second.opens.length, 0);
  second.session.open(skill);
  second.session.open(skill);
  assert.deepEqual(second.opens, [normalInstallAction(skill).href]);
  assert.match(second.session.getSnapshot().message, /^Opening requested/);
  assert.doesNotMatch(second.session.getSnapshot().message, /Installed|app is missing/);
  second.session.reset();
  assert.equal(second.disk.getItem(normalKey), null);
  assert.match(second.session.getSnapshot().message, /Mac app is unchanged/);
});

test("normal and preview intents never cross contexts, even when copied between keys", () => {
  const { session, disk } = fixture();
  session.showSetup(skill);
  const preview = new InstallIntentStore(() => disk, "setup-test");
  assert.equal(preview.read().intent, null);
  disk.setItem(`${INSTALL_INTENT_KEY}.setup-test`, disk.getItem(normalKey)!);
  assert.equal(new InstallIntentStore(() => disk, "setup-test").read().invalid, true);
  const previewIntent = intentFromAction(skill, { href: developmentInstallLink(skill, "a".repeat(40), "setup-test"), reason: "" },
    route.replace("/app/", "/app/preview/unified/"), now, "setup-test")!;
  disk.setItem(normalKey, JSON.stringify(previewIntent));
  assert.equal(fixture({ disk }).session.getSnapshot().restartRequired, true);
});

test("normal retry refuses source changes, pins and expired intent without launching", async () => {
  for (const change of [{ githubUrl: "https://github.com/example/other" }, { skillMDPath: "other/SKILL.md" }, { catalogId: "other" }, { hasPinnedInstall: true }]) {
    const f = fixture({ refresh: async () => ({ ...skill, ...change }) });
    f.session.showSetup(skill);
    await f.session.retry();
    assert.equal(f.session.getSnapshot().restartRequired, true);
    assert.equal(f.opens.length, 0);
  }
  let time = now;
  const f = fixture({ clock: () => time });
  f.session.showSetup(skill);
  time += INSTALL_INTENT_TTL;
  await f.session.retry();
  assert.equal(f.session.getSnapshot().restartRequired, true);
});

test("changed selection or changed displayed source cannot use a prepared request", async () => {
  for (const change of [{ key: "catalog:other", catalogId: "other" }, { githubUrl: "https://github.com/example/other" }]) {
    const f = fixture();
    f.session.showSetup(skill);
    await f.session.retry();
    f.session.open({ ...skill, ...change });
    assert.equal(f.session.getSnapshot().restartRequired, true);
    assert.equal(f.opens.length, 0);
  }
});

test("normal memory fallback and interrupted retry remain usable without automatic launch", async () => {
  const store = new InstallIntentStore(() => { throw new Error("Unavailable"); }, "setup-test", "normal");
  let finish!: (value: SkillDisplay) => void;
  const opens: string[] = [];
  const session = new InstallSetupSession({ client: "setup-test", catalogId: skill.catalogId!, returnRoute: route, store,
    now: () => now, action: normalInstallAction, refresh: () => new Promise(resolve => { finish = resolve; }), open: href => { opens.push(href); } });
  session.showSetup(skill);
  const pending = session.retry();
  session.abort();
  finish(skill);
  await pending;
  assert.equal(store.persistent, false);
  assert.equal(session.getSnapshot().phase, "blocked");
  assert.equal(session.getSnapshot().restartRequired, false);
  const retry = session.retry();
  finish(skill);
  await retry;
  assert.equal(session.getSnapshot().phase, "ready");
  assert.deepEqual(opens, []);
});

test("shared component renders the fixed B ZIP setup; pending/unsupported details cannot launch", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/PublicInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { PublicInstallSetup: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const f = fixture({ clock: Date.now });
  const props = { skill, detailReady: true, returnRoute: route, store: f.store, client: "setup-test",
    action: normalInstallAction, distribution: setupTestDistribution };
  const render = (changes = {}) => renderToStaticMarkup(createElement(module.exports.PublicInstallSetup, { ...props, ...changes }));
  assert.match(render(), /Review in OMGSkills Setup Test/);
  for (const changes of [{ detailReady: false }, { skill: { ...skill, hasPinnedInstall: true } }]) {
    assert.match(render(changes), /disabled=""/);
  }
  f.session.showSetup(skill);
  const html = render();
  assert.ok(html.includes(`href="${setupTestDistribution.url}"`));
  assert.ok(html.includes(setupTestDistribution.filename));
  assert.ok(html.includes(setupTestDistribution.app));
  assert.match(html, /Apple silicon Mac, macOS 14/);
  assert.doesNotMatch(html, /0\.1\.0|\.dmg|omgskills\.com\/download|Installed successfully/);
  assert.equal(setupTestDistribution.sha256, "ceb11e69872876085e0728289841f70a4f0e5b35b901facfce250fb366569880");
  assert.equal(setupTestDistribution.scheme, "omgskills-setup-test");
  assert.equal(setupTestDistribution.bundleId, "com.jonslimak.omgskills.setuptest");
  assert.equal(setupTestDistribution.build, "3");
});
