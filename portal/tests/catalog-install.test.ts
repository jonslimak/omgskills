import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogInstallAction, catalogInstallTestEnabled, normalInstallClient } from "../src/app/unified/public-install";
import { CatalogInstallIntentStore, CatalogInstallSetupSession, CATALOG_INSTALL_INTENT_KEY } from "../src/app/unified/catalog-install-intent";
import { INSTALL_INTENT_TTL, NORMAL_INSTALL_INTENT_KEY } from "../src/app/unified/install-intent";
import type { SkillDisplay } from "../src/app/unified/model";
import { catalogInstallMiddleware, catalogInstallServerEnabled, localCatalogLoader } from "../catalog-install-test-server";

const skill: SkillDisplay = { key: "catalog:example/repo", catalogId: "example/repo", name: "novel", author: "example", description: "", tags: [], githubUrl: null };
const route = `/app/?view=discover&skill=${encodeURIComponent(skill.key)}`;
const now: number = 1800000000000;
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function fixture({ disk = storage(), agent = "codex" as "codex" | "claude", refresh = async () => skill, clock = () => now } = {}) {
  const store = new CatalogInstallIntentStore(() => disk), opens: string[] = [];
  const session = new CatalogInstallSetupSession({ catalogId: skill.catalogId!, agent, returnRoute: route, store,
    now: clock, refresh, open: href => { opens.push(href); } });
  return { disk, store, session, opens };
}

test("new mode is explicit, local-only and refuses conflicting modes", () => {
  for (const host of ["localhost", "127.0.0.1"]) assert.ok(catalogInstallTestEnabled(true, "1", host));
  for (const host of ["omgskills.com", "localhost.evil.test", "127.0.0.2", ""]) assert.equal(catalogInstallTestEnabled(true, "1", host), false);
  assert.equal(catalogInstallTestEnabled(false, "1", "localhost"), false);
  for (const flag of [undefined, "0", true, 1]) assert.equal(catalogInstallTestEnabled(true, flag, "localhost"), false);
  assert.equal(catalogInstallTestEnabled(true, "1", "localhost", "1"), false);
  assert.equal(normalInstallClient(true, "1", "localhost", "1"), null);
  assert.equal(catalogInstallServerEnabled("build", { VITE_NEWMAC_CATALOG_INSTALL_TEST: "1" }), false);
  assert.equal(catalogInstallServerEnabled("serve", {}), false);
  for (const key of ["VITE_NEWMAC_WEB_INSTALL_TEST", "VITE_NEWMAC_F1", "VITE_NEWMAC_SETUP_TEST", "VITE_PORTAL_INTEGRATION", "VITE_PORTAL_PREVIEW"]) {
    assert.throws(() => catalogInstallServerEnabled("serve", { VITE_NEWMAC_CATALOG_INSTALL_TEST: "1", [key]: "1" }));
  }
});

test("both targets use ID-only handoff, including missing paths and pinned details", () => {
  for (const agent of ["codex", "claude"] as const) {
    for (const change of [{}, { hasPinnedInstall: true }, { githubUrl: "https://github.com/example/repo/tree/main" }, { skillMDPath: "alias/SKILL.md" }]) {
      const link = new URL(catalogInstallAction({ ...skill, ...change }, agent).href!);
      assert.equal(link.protocol, "omgskills-f1:");
      assert.equal(link.host, "catalog-install");
      assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: skill.catalogId, agent });
    }
  }
  for (const change of [{ catalogId: undefined }, { key: "synced:x" }, { setItemKind: "catalog" as const },
    { key: "catalog:x", catalogId: "x\n" }, { key: "catalog:" + "x".repeat(501), catalogId: "x".repeat(501) }]) {
    assert.equal(catalogInstallAction({ ...skill, ...change }, "codex").href, null);
  }
});

test("reload and explicit retry never launch automatically; only one open per click", async () => {
  for (const agent of ["codex", "claude"] as const) {
    const first = fixture({ agent });
    first.session.showSetup(skill);
    assert.deepEqual(Object.keys(JSON.parse(first.disk.getItem(CATALOG_INSTALL_INTENT_KEY)!)).sort(), ["agent", "catalogId", "createdAt", "returnRoute", "version"]);
    const next = fixture({ disk: first.disk, agent, refresh: async () => ({ ...skill, hasPinnedInstall: true, githubUrl: "changed" }) });
    assert.equal(next.session.getSnapshot().phase, "setup");
    await next.session.retry();
    assert.equal(next.session.getSnapshot().phase, "ready");
    assert.deepEqual(next.opens, []);
    next.session.open(skill); next.session.open(skill);
    assert.deepEqual(next.opens, [catalogInstallAction(skill, agent).href]);
    assert.match(next.session.getSnapshot().message, /^Opening requested/);
    assert.doesNotMatch(next.session.getSnapshot().message, /Installed|app is missing/);
    next.session.reset();
    assert.equal(next.disk.getItem(CATALOG_INSTALL_INTENT_KEY), null);
  }
});

test("legacy requests, changed ID/target, expiry and missing details cannot resume", async () => {
  const first = fixture(); first.session.showSetup(skill);
  assert.equal(fixture({ disk: first.disk, agent: "claude" }).session.getSnapshot().restartRequired, true);
  for (const change of [{ repository: "example/repo", path: "SKILL.md" }, { returnRoute: "https://evil.test" + route },
    { returnRoute: route + "&agent=claude" }, { version: 2 }]) {
    const disk = storage();
    disk.setItem(CATALOG_INSTALL_INTENT_KEY, JSON.stringify({ ...first.store.read().intent, ...change }));
    assert.equal(fixture({ disk }).session.getSnapshot().restartRequired, true);
  }
  const disk = storage(); disk.setItem(NORMAL_INSTALL_INTENT_KEY + ".setup-test", first.disk.getItem(CATALOG_INSTALL_INTENT_KEY)!);
  assert.equal(fixture({ disk }).store.read().intent, null);
  for (const refresh of [async () => null, async () => ({ ...skill, catalogId: "other" })]) {
    const f = fixture({ refresh: refresh as () => Promise<SkillDisplay> }); f.session.showSetup(skill);
    await f.session.retry(); assert.equal(f.session.getSnapshot().restartRequired, true); assert.deepEqual(f.opens, []);
  }
  const expired = fixture({ disk: first.disk, clock: () => now + INSTALL_INTENT_TTL });
  assert.equal(expired.session.getSnapshot().restartRequired, true);
});

test("memory fallback, cancellation and late responses preserve explicit approval", async () => {
  const store = new CatalogInstallIntentStore(() => { throw Error("Disabled"); });
  let finish!: (value: SkillDisplay) => void;
  const opens: string[] = [];
  const session = new CatalogInstallSetupSession({ catalogId: skill.catalogId!, agent: "claude", returnRoute: route, store,
    now: () => now, refresh: () => new Promise(resolve => { finish = resolve; }), open: href => { opens.push(href); } });
  session.showSetup(skill); const pending = session.retry(); session.reset(); finish(skill); await pending;
  assert.equal(store.persistent, false); assert.equal(session.getSnapshot().phase, "idle"); assert.deepEqual(opens, []);
  session.showSetup(skill); const next = session.retry(); session.abort(); finish(skill); await next;
  assert.equal(session.getSnapshot().phase, "blocked"); assert.equal(session.getSnapshot().restartRequired, false);
});

test("real HTTP bridge shares one local raw snapshot, never permits account access", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-install-server-"));
  const raw = { id: skill.catalogId, name: "novel", description: "Example", author_handle: "example", github_url: "https://github.com/example/repo",
    install_cmd: "unused", repo_slug: "example/repo", install_target_name: "alias", repo_commit_sha: "a".repeat(40) };
  await mkdir(join(root, "index")); await writeFile(join(root, "index/skills.json"), JSON.stringify([raw]));
  const loader = localCatalogLoader(root);
  const middleware = catalogInstallMiddleware(loader);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const record = await fetch(origin + "/api/catalog/install-record?id=" + encodeURIComponent(raw.id!));
    assert.equal(record.status, 200); assert.equal(record.headers.get("cache-control"), "no-store");
    const payload = await record.json(); assert.equal(payload.skill.install_target_name, "alias");
    assert.equal(payload.skill.repo_commit_sha, raw.repo_commit_sha); assert.equal(payload.skill.skill_md_path, undefined);
    const rpc = await fetch(origin + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fake", Cookie: "test=fake" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_skill", arguments: { id: raw.id } } }) });
    assert.equal(rpc.status, 200); assert.equal((await rpc.json()).result.structuredContent.skill.id, raw.id);
    await writeFile(join(root, "index/skills.json"), "[]");
    assert.equal((await (await fetch(origin + "/mcp/health")).json()).skillCount, 1);
    assert.equal((await (await fetch(origin + "/api/catalog/install-record?id=missing")).json()).found, false);
    for (const method of ["GET", "POST", "DELETE"]) assert.equal((await fetch(origin + "/api/portal/skills", { method })).status, 403);
    assert.equal((await fetch(origin + "/api/catalog/install-record", { method: "POST" })).status, 405);
    assert.equal((await fetch(origin + "/mcp")).status, 405);
    const rejectedHost = await new Promise<number>(resolve => {
      request(origin + "/mcp/health", { headers: { Host: "evil.test" } }, response => {
        response.resume(); resolve(response.statusCode!);
      }).end();
    });
    assert.equal(rejectedHost, 403);
    assert.equal((await fetch(origin + "/mcp", { method: "POST", body: "x".repeat(65537) })).status, 413);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true });
  }
});
