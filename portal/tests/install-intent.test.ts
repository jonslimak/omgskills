import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { INSTALL_INTENT_KEY, INSTALL_INTENT_TTL, InstallIntentStore, InstallSetupSession, intentFromAction } from "../src/app/unified/install-intent";
import { developmentInstallLink, installClients, type InstallClient } from "../src/app/unified/public-install";
import type { SkillDisplay } from "../src/app/unified/model";
import { f2Cases, f2InstallAction } from "../src/preview/unified/f2-install";

const now = 1_800_000_000_000;
const commit = "a".repeat(40);
const skill: SkillDisplay = { key: "catalog:owner/repo:skills/example", catalogId: "owner/repo:skills/example", name: "example",
  author: "owner", description: "", tags: [], githubUrl: "https://github.com/owner/repo", skillMDPath: "skills/example/SKILL.md" };
const route = `/app/preview/unified/?view=discover&skill=${encodeURIComponent(skill.key)}`;
const action = (value: SkillDisplay, pin: string | null = commit) => ({ href: developmentInstallLink(value, pin ?? undefined), reason: "Source unavailable." });
const intent = intentFromAction(skill, action(skill), route, now)!;

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function fixture(options: { raw?: string; pin?: string | null; clock?: () => number; opener?: (href: string) => void;
  refresh?: (id: string, signal: AbortSignal) => Promise<SkillDisplay | null>; store?: InstallIntentStore } = {}) {
  const disk = storage();
  if (options.raw !== undefined) disk.setItem(INSTALL_INTENT_KEY, options.raw);
  const store = options.store ?? new InstallIntentStore(() => disk);
  const opens: string[] = [], reads: string[] = [];
  const pin = options.pin === null ? undefined : options.pin ?? commit;
  const session = new InstallSetupSession({ catalogId: skill.catalogId!, commit: pin, returnRoute: route, store,
    now: options.clock ?? (() => now), action: value => action(value, pin ?? null),
    refresh: async (id, signal) => { reads.push(id); return options.refresh ? options.refresh(id, signal) : skill; },
    open: href => { opens.push(href); options.opener?.(href); } });
  return { session, store, disk, opens, reads };
}

test("intent keeps bounded source/version/route only, never a trusted link or approval", () => {
  assert.deepEqual(intent, { version: 1, catalogId: skill.catalogId, repository: "owner/repo", path: skill.skillMDPath,
    agent: "codex", commit, returnRoute: route, createdAt: now });
  for (const href of ["https://evil.test", `${action(skill).href}&approved=true`, "javascript:alert(1)"]) {
    assert.equal(intentFromAction(skill, { href, reason: "" }, route, now), null);
  }
  for (const returnRoute of ["https://evil.test/app/preview/unified/", "//evil.test", "/app/connect", `${route}#secret`,
    `${route}&download=https://evil.test`, `${route}&skill=catalog:other`, route.replace("skill=", "other="), `${route}&q=\n`]) {
    assert.equal(intentFromAction(skill, action(skill), returnRoute, now), null, returnRoute);
  }
});

test("fresh session, setup, reload and back never launch, fetch or claim installation", () => {
  const { session, disk, opens, reads } = fixture();
  assert.equal(session.getSnapshot().phase, "idle");
  session.showSetup(skill);
  assert.equal(session.getSnapshot().phase, "setup");
  assert.deepEqual(JSON.parse(disk.getItem(INSTALL_INTENT_KEY)!), intent);
  const restored = fixture({ raw: disk.getItem(INSTALL_INTENT_KEY)! });
  assert.equal(restored.session.getSnapshot().phase, "setup");
  assert.deepEqual(restored.session.getSnapshot().intent, intent);
  assert.deepEqual([...opens, ...restored.opens, ...reads, ...restored.reads], []);
  assert.doesNotMatch(restored.session.getSnapshot().message, /installed|app is missing/i);
});

test("initial opening saves intent first; duplicate click does not launch twice", () => {
  const disk = storage();
  const store = new InstallIntentStore(() => disk);
  const { session, opens } = fixture({ store, opener: () => assert.ok(disk.getItem(INSTALL_INTENT_KEY)) });
  session.open(skill);
  session.open(skill);
  assert.equal(opens.length, 1);
  assert.equal(session.getSnapshot().phase, "opening");
  assert.match(session.getSnapshot().message, /Opening requested/);
});

test("absent handler, denied browser prompt and no callback remain unknown", async () => {
  for (const opener of [() => {}, () => { throw new Error("No handler"); }]) {
    const { session, opens } = fixture({ opener });
    session.open(skill);
    assert.equal(session.getSnapshot().phase, "opening");
    assert.doesNotMatch(session.getSnapshot().message, /installed|not installed|missing/i);
    await session.retry();
    assert.equal(session.getSnapshot().phase, "ready");
    assert.equal(opens.length, 1, "revalidation must not open outside a click");
    session.open(skill);
    assert.equal(opens.length, 2);
  }
});

test("retry fetches matching current detail and needs a separate open click", async () => {
  const { session, reads, opens } = fixture();
  session.showSetup(skill);
  await session.retry();
  assert.deepEqual(reads, [skill.catalogId]);
  assert.equal(session.getSnapshot().phase, "ready");
  assert.deepEqual(opens, []);
  session.open(skill);
  assert.equal(new URL(opens[0]).searchParams.get("commit"), commit);
});

test("Latest remains unpinned in the request; native review resolves its exact bytes", async () => {
  const { session, opens } = fixture({ pin: null });
  session.showSetup(skill);
  assert.equal(session.getSnapshot().intent?.commit, undefined);
  await session.retry();
  session.open(skill);
  assert.equal(new URL(opens[0]).searchParams.has("commit"), false);
});

test("changed ID, repository, path, pin or unavailable metadata refuse retry", async () => {
  const changes: Array<SkillDisplay | null> = [null, { ...skill, catalogId: "other/repo" },
    { ...skill, githubUrl: "https://github.com/other/repo" }, { ...skill, skillMDPath: "different/SKILL.md" },
    { ...skill, skillMDPath: undefined }, { ...skill, hasPinnedInstall: true }];
  for (const fresh of changes) {
    const { session, opens } = fixture({ refresh: async () => fresh });
    session.showSetup(skill);
    await session.retry();
    assert.equal(session.getSnapshot().phase, "blocked");
    assert.equal(session.getSnapshot().restartRequired, true);
    session.open(skill);
    assert.deepEqual(opens, []);
  }
  const changedVersion = fixture({ raw: JSON.stringify(intent), pin: "b".repeat(40) });
  assert.equal(changedVersion.session.getSnapshot().restartRequired, true);
});

test("malformed or injected stored requests are blocked, not normalized into approvals", () => {
  const values = ["bad json", "x".repeat(8193), "null", "[]", JSON.stringify({ ...intent, version: 2 }),
    ...[{ agent: "claude" }, { commit: "main" }, { createdAt: "yesterday" }, { path: "../SKILL.md" },
      { catalogId: "wrong/id" }, { repository: "../other/repo" }, { returnRoute: "https://evil.test" },
      { href: "omgskills://anything" }, { installed: true }, { destination: "/real/home" }, { approval: true }]
      .map(change => JSON.stringify({ ...intent, ...change }))];
  for (const raw of values) {
    const { session, opens } = fixture({ raw });
    assert.equal(session.getSnapshot().phase, "blocked", raw);
    session.open(skill);
    assert.deepEqual(opens, []);
  }
});

test("expired and future intents cannot resume; web cancel allows a new explicit action", () => {
  for (const createdAt of [now - INSTALL_INTENT_TTL, now + 1]) {
    const { session, store, opens } = fixture({ raw: JSON.stringify({ ...intent, createdAt }) });
    assert.equal(session.getSnapshot().phase, "blocked");
    session.open(skill);
    assert.deepEqual(opens, []);
    session.reset();
    assert.equal(store.read().intent, null);
    session.showSetup(skill);
    assert.equal(session.getSnapshot().intent?.createdAt, now);
  }
});

test("expiry is rechecked after async refresh and again at the Open click", async () => {
  let clock = now;
  const first = fixture({ clock: () => clock, refresh: async () => { clock += INSTALL_INTENT_TTL; return skill; } });
  first.session.showSetup(skill);
  await first.session.retry();
  assert.equal(first.session.getSnapshot().phase, "blocked");
  clock = now;
  const second = fixture({ clock: () => clock });
  second.session.showSetup(skill);
  await second.session.retry();
  clock += INSTALL_INTENT_TTL;
  second.session.open(skill);
  assert.equal(second.session.getSnapshot().phase, "blocked");
  assert.deepEqual(second.opens, []);
});

test("catalog error allows a manual retry, never an automatic open", async () => {
  let attempt = 0;
  const { session, opens } = fixture({ refresh: async () => { if (++attempt === 1) throw new Error("Catalog unavailable"); return skill; } });
  session.showSetup(skill);
  await session.retry();
  assert.equal(session.getSnapshot().phase, "blocked");
  assert.equal(session.getSnapshot().restartRequired, false);
  await session.retry();
  assert.equal(session.getSnapshot().phase, "ready");
  assert.deepEqual(opens, []);
});

test("double retry is coalesced; cancel/unmount invalidates late refresh results", async () => {
  for (const cancel of [true, false]) {
    let finish!: (value: SkillDisplay) => void;
    let signal!: AbortSignal;
    const { session, reads, opens, store } = fixture({ refresh: (_, token) => { signal = token; return new Promise(resolve => { finish = resolve; }); } });
    session.showSetup(skill);
    const pending = session.retry();
    await session.retry();
    assert.equal(reads.length, 1);
    if (cancel) session.reset(); else session.abort();
    finish(skill);
    await pending;
    assert.equal(signal.aborted, true);
    assert.notEqual(session.getSnapshot().phase, "ready");
    assert.deepEqual(opens, []);
    assert.equal(!!store.read().intent, !cancel);
  }
});

test("storage read/write failures fall back to memory without blocking explicit retry", async () => {
  for (const getStorage of [() => { throw new Error("Disabled"); }, () => ({
    getItem: () => null, setItem: () => { throw new Error("Quota"); }, removeItem: () => {},
  })]) {
    const store = new InstallIntentStore(getStorage);
    const { session, opens } = fixture({ store });
    session.showSetup(skill);
    assert.equal(store.persistent, false);
    assert.deepEqual(store.read().intent, intent);
    await session.retry();
    session.open(skill);
    assert.equal(opens.length, 1);
    session.reset();
    assert.equal(store.read().intent, null);
  }
});

test("failed save removes the old disk request; cancellation clears both stores", () => {
  const disk = storage();
  disk.setItem(INSTALL_INTENT_KEY, JSON.stringify(intent));
  const store = new InstallIntentStore(() => ({ ...disk, setItem: () => { throw new Error("Quota"); } }));
  store.save({ ...intent, createdAt: now + 10 });
  assert.equal(disk.getItem(INSTALL_INTENT_KEY), null);
  assert.equal(store.read().intent?.createdAt, now + 10);
  store.clear();
  assert.equal(store.read().intent, null);
});

test("separate tabs have independent pending requests; a new selection clears only its tab", () => {
  const first = fixture(), second = fixture();
  first.session.showSetup(skill);
  second.session.showSetup(skill);
  first.session.reset();
  assert.equal(first.store.read().intent, null);
  assert.deepEqual(second.store.read().intent, intent);
});

test("setup-test state is separate from F1 and retry preserves the handler without auto-opening", async () => {
  const disk = storage();
  const f1 = new InstallIntentStore(() => disk);
  f1.save(intent);
  const setup = new InstallIntentStore(() => disk, "setup-test");
  assert.equal(setup.read().intent, null);
  const candidateAction = (value: SkillDisplay) => ({ href: developmentInstallLink(value, commit, "setup-test"), reason: "" });
  assert.equal(intentFromAction(skill, candidateAction(skill), route, now), null);
  assert.equal(intentFromAction(skill, action(skill), route, now, "setup-test"), null);
  const opens: string[] = [];
  const options = { client: "setup-test" as const, catalogId: skill.catalogId!, commit, returnRoute: route,
    now: () => now, action: candidateAction, refresh: async () => skill, open: (href: string) => { opens.push(href); } };
  const first = new InstallSetupSession({ ...options, store: setup });
  first.showSetup(skill);
  const restored = new InstallSetupSession({ ...options, store: new InstallIntentStore(() => disk, "setup-test") });
  assert.equal(restored.getSnapshot().phase, "setup");
  assert.deepEqual(restored.getSnapshot().intent, intent);
  await restored.retry();
  assert.equal(restored.getSnapshot().phase, "ready");
  assert.deepEqual(opens, []);
  restored.open(skill);
  restored.open(skill);
  assert.deepEqual(opens, [candidateAction(skill).href]);
  assert.match(restored.getSnapshot().message, /Check OMGSkills Setup Test/);
  restored.reset();
  assert.equal(new InstallIntentStore(() => disk, "setup-test").read().intent, null);
  assert.deepEqual(new InstallIntentStore(() => disk).read().intent, intent);
});

test("preview wiring gates setup, disables download and suppresses the normal app download only for install previews", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const preview = read("../src/preview/unified/main.tsx");
  assert.match(preview, /publicInstallAction=\{installClient \?/);
  assert.match(preview, /installClient \? createPreviewInstallStore\(installClient\) : null/);
  assert.match(preview, /const installClient = import.meta.env.DEV \? previewInstallClient/);
  assert.match(preview, /detailReady=\{detailReady && liveCatalog\}/);
  assert.match(preview, /next.selected && next.selected !== nav.selected\) installStore\?\.clear\(\)/);
  const component = read("../src/preview/unified/PublicInstallSetup.tsx");
  assert.match(component, /SharedInstallSetup/);
  assert.doesNotMatch(component, /distribution=/);
  const shared = read("../src/app/unified/PublicInstallSetup.tsx");
  assert.match(shared, /new PublicCatalogClient\(\)\.skill/);
  assert.match(shared, /disabled aria-describedby="ua-download-status"/);
  assert.doesNotMatch(component, /https:\/\/omgskills.com\/download|setTimeout|visibilitychange|window.open/);
  const ui = read("../src/app/unified/UnifiedApp.tsx");
  assert.match(ui, /!publicInstallAction && <a\s+className="ua-sidebar-download"\s+href="\/download"/);
  assert.match(ui, /publicInstallAction\?\.\(selected, !detailPending\)/);
  const production = read("../src/unified-main.tsx");
  assert.doesNotMatch(production, /PublicInstallSetup|InstallSetupSession|publicInstallAction|install-intent/);
});

test("actual setup component renders restored intent and a disabled download without browser actions", async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/preview/unified/PublicInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { PublicInstallSetup: Parameters<typeof createElement>[0] } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const item = f2Cases.find(value => value.key === "writing-guidelines-recorded")!;
  const sample = { ...skill, key: `catalog:${item.source.id}`, catalogId: item.source.id,
    githubUrl: `https://github.com/${item.source.repository}`, skillMDPath: item.source.path };
  const returnRoute = `/app/preview/unified/?skill=${encodeURIComponent(sample.key)}&f2case=${item.key}`;
  for (const client of ["f1", "setup-test"] satisfies InstallClient[]) {
    const disk = storage(), store = new InstallIntentStore(() => disk, client);
    const props = { skill: sample, detailReady: true, caseKey: item.key, returnRoute, store, client };
    const initial = renderToStaticMarkup(createElement(module.exports.PublicInstallSetup, props));
    assert.ok(initial.includes(`Open in ${installClients[client].name}`));
    assert.equal(disk.data.size, 0);
    store.save(intentFromAction(sample, f2InstallAction(sample, item.key, client), returnRoute, Date.now(), client)!);
    const restored = renderToStaticMarkup(createElement(module.exports.PublicInstallSetup, props));
    assert.match(restored, /Try opening again/);
    assert.match(restored, /disabled="" aria-describedby="ua-download-status"/);
    assert.match(restored, /The signed test download is not available yet/);
    assert.match(restored, /Exact version 063bee94/);
    assert.doesNotMatch(restored, /href="https:\/\/omgskills.com\/download"|Installed successfully/);
  }
});
