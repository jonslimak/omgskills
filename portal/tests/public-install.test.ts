import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { developmentInstallLink, isF1Preview } from "../src/app/unified/public-install";
import { PublicCatalogClient } from "../src/app/unified/public-catalog";
import type { SkillDisplay } from "../src/app/unified/model";
import { parseNavigation } from "../src/app/unified/model";
import { f2Sources, f2Cases, f2CaseNavigation, f2InstallAction, f2NavigationSearch, readF2CaseKey } from "../src/preview/unified/f2-install";

function display(source = f2Sources[0]): SkillDisplay {
  return { key: `catalog:${source.id}`, catalogId: source.id, name: source.key, author: source.repository.split("/")[0],
    description: "", tags: [], githubUrl: `https://github.com/${source.repository}`, skillMDPath: source.path };
}
const skill = display();

test("F1 requires development, explicit flag, and loopback host", () => {
  assert.equal(isF1Preview(true, "1", "127.0.0.1"), true);
  for (const args of [[false, "1", "localhost"], [true, undefined, "localhost"], [true, "1", "omgskills.com"]] as const) {
    assert.equal(isF1Preview(...args), false);
  }
});

test("handoff carries source and optional commit, never destination, package bytes or approval", () => {
  for (const source of f2Sources) {
    const value = { ...display(source), catalogId: "old-owner/alias:attribution" };
    const link = new URL(developmentInstallLink(value, "A".repeat(40))!);
    assert.equal(link.protocol, "omgskills-f1:");
    assert.equal(link.hostname, "review");
    assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: value.catalogId, repo: source.repository,
      path: source.path, agent: "codex", commit: "a".repeat(40) });
    assert.equal(new URL(developmentInstallLink(value)!).searchParams.has("commit"), false);
  }
});

test("request validation preserves native bounds and rejects normalization tricks", () => {
  const invalid: Partial<SkillDisplay>[] = [
    { catalogId: undefined }, { catalogId: "x".repeat(501) }, { catalogId: "bad\u0000id" },
    { skillMDPath: undefined }, { skillMDPath: "../SKILL.md" }, { skillMDPath: "x//SKILL.md" },
    { skillMDPath: "x/.GIT/SKILL.md" }, { skillMDPath: "x\\SKILL.md" }, { skillMDPath: "skill.md" },
    { skillMDPath: "x\n/SKILL.md" }, { skillMDPath: "bad name/SKILL.md" }, { skillMDPath: "x".repeat(129) + "/SKILL.md" },
    { skillMDPath: "x/".repeat(520) + "SKILL.md" }, { hasPinnedInstall: true },
    { githubUrl: "http://github.com/owner/repo" }, { githubUrl: "https://evil.test/owner/repo" },
    { githubUrl: "https://github.com/owner/repo?token=x" }, { githubUrl: "https://github.com/owner/repo#x" },
    { githubUrl: "https://user@github.com/owner/repo" }, { githubUrl: "https://github.com:443/owner/repo" },
    { githubUrl: "https://github.com/owner/x/../repo" }, { githubUrl: "https://github.com/owner/%72epo" },
    { githubUrl: "https://github.com/-owner/repo" }, { githubUrl: "https://github.com/owner-/repo" },
    { githubUrl: "https://github.com/owner/." }, { githubUrl: "https://github.com/owner/.." },
    { githubUrl: `https://github.com/${"x".repeat(40)}/repo` }, { githubUrl: `https://github.com/owner/${"x".repeat(101)}` },
    { catalogId: "é".repeat(250), skillMDPath: "é".repeat(490) + "/skill/SKILL.md" },
  ];
  for (const change of invalid) assert.equal(developmentInstallLink({ ...skill, ...change }), null, JSON.stringify(change));
  for (const commit of ["main", "", "a".repeat(39), "g".repeat(40)]) assert.equal(developmentInstallLink(skill, commit), null);
});

test("fixture policy binds exact ID/repo/path, pins and revisions to each source", () => {
  for (const item of f2Cases) {
    const value = display(item.source);
    const result = f2InstallAction(value, item.key);
    assert.ok(result.href);
    assert.equal(result.reason, "");
    assert.equal(new URL(result.href).searchParams.get("commit"), item.commit ?? null);
    for (const change of [{ catalogId: "different" }, { skillMDPath: "other/SKILL.md" },
      { githubUrl: "https://github.com/other/source" }, { hasPinnedInstall: true }, { skillMDPath: undefined }]) {
      const denied = f2InstallAction({ ...value, ...change }, item.key);
      assert.equal(denied.href, null);
      assert.ok(denied.reason);
    }
  }
  for (const key of ["", "humanizer-a&commit=bad", "unknown"]) assert.equal(f2InstallAction(skill, key).href, null);
  assert.equal(f2InstallAction(display(f2Sources[1]), "humanizer-a").href, null);
  assert.equal(f2Cases.filter(item => item.key.endsWith("-a")).length, 1);
});

test("exact case links survive refresh, close/reopen and history navigation", () => {
  const history = f2Cases.map(item => f2NavigationSearch(f2CaseNavigation(item.key)!, item.key));
  for (const search of [...history, ...history.toReversed()]) {
    const caseKey = readF2CaseKey(search), nav = parseNavigation(search);
    const item = f2Cases.find(item => item.key === caseKey)!;
    assert.equal(nav.selected, `catalog:${item.source.id}`);
    assert.equal(f2NavigationSearch(nav, caseKey), search);
    const closed = f2NavigationSearch({ ...nav, selected: "" }, caseKey);
    assert.equal(readF2CaseKey(closed), caseKey);
    assert.equal(f2NavigationSearch(nav, readF2CaseKey(closed)), search);
    assert.ok(f2InstallAction(display(item.source), caseKey).href);
  }
  assert.equal(f2CaseNavigation("unknown"), null);
  for (const search of ["", "?f2case=unknown", "?f2case=humanizer-a&f2case=humanizer-latest", "?commit=" + "a".repeat(40)]) {
    assert.equal(readF2CaseKey(search), "");
  }
  const injected = "?f2case=humanizer-latest&commit=" + "a".repeat(40) + "&repo=evil/repo";
  assert.equal(new URL(f2InstallAction(skill, readF2CaseKey(injected)).href!).searchParams.has("commit"), false);
});

test("public detail preserves path and distinguishes pinned records", async () => {
  for (const pin of [{}, { pinned_install: { commit_sha: "a".repeat(40) } }, { repo_commit_sha: "a".repeat(40) }, { skill_tree_sha: "b".repeat(40) }]) {
    const client = new PublicCatalogClient(async (_, init) => new Response(JSON.stringify({
      jsonrpc: "2.0", id: JSON.parse(init!.body as string).id,
      result: { structuredContent: { found: true, skill: { id: skill.catalogId, name: skill.name,
        author_handle: skill.author, description: "", github_url: skill.githubUrl,
        skill_md_path: skill.skillMDPath, ...pin } } },
    }), { headers: { "content-type": "application/json" } }));
    const parsed = await client.skill(skill.catalogId!, new AbortController().signal);
    assert.equal(parsed?.skillMDPath, skill.skillMDPath);
    assert.equal(parsed?.hasPinnedInstall, Object.keys(pin).length > 0);
  }
});

test("production entry never supplies the test action", () => {
  const source = readFileSync(new URL("../src/unified-main.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /publicInstallAction|developmentInstallLink|VITE_NEWMAC_F1|f2-install/);
  const preview = readFileSync(new URL("../src/preview/unified/main.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(preview, /VITE_NEWMAC_F1_[AB]|f1Revision/);
  assert.match(preview, /setF2CaseKey\(caseKey\)/);
  assert.match(preview, /publicInstallAction=\{f1Enabled \?/);
});
