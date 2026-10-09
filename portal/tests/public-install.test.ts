import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { f1Fixture, f1InstallLink, isF1Preview } from "../src/app/unified/public-install";
import { PublicCatalogClient } from "../src/app/unified/public-catalog";
import type { SkillDisplay } from "../src/app/unified/model";

const skill: SkillDisplay = { key: `catalog:${f1Fixture.id}`, catalogId: f1Fixture.id,
  name: "frontend-design", author: "anthropics", description: "", tags: [],
  githubUrl: "https://github.com/anthropics/skills", skillMDPath: f1Fixture.path };

test("F1 requires development, explicit flag, and loopback host", () => {
  assert.equal(isF1Preview(true, "1", "127.0.0.1"), true);
  for (const args of [[false, "1", "localhost"], [true, undefined, "localhost"], [true, "1", "omgskills.com"]] as const) {
    assert.equal(isF1Preview(...args), false);
  }
});

test("handoff carries source and optional commit, never destination, package bytes or approval", () => {
  const link = new URL(f1InstallLink(skill, "A".repeat(40))!);
  assert.equal(link.protocol, "omgskills-f1:");
  assert.equal(link.hostname, "review");
  assert.deepEqual(Object.fromEntries(link.searchParams), { v: "1", id: f1Fixture.id, repo: f1Fixture.repo,
    path: f1Fixture.path, agent: "codex", commit: "a".repeat(40) });
  assert.equal(new URL(f1InstallLink(skill)!).searchParams.has("commit"), false);
});

test("missing source, other skills and pinned catalog records cannot use F1", () => {
  for (const change of [{ skillMDPath: undefined }, { catalogId: "other" }, { hasPinnedInstall: true },
    { githubUrl: "https://github.com/anthropics/skills?token=x" }, { githubUrl: "https://evil.test/anthropics/skills" }]) {
    assert.equal(f1InstallLink({ ...skill, ...change }), null);
  }
  assert.equal(f1InstallLink(skill, "main"), null);
  assert.equal(f1InstallLink(skill, ""), null);
});

test("public detail preserves path and distinguishes pinned records", async () => {
  for (const pinned_install of [undefined, { commit_sha: "a".repeat(40) }]) {
    const client = new PublicCatalogClient(async (_, init) => new Response(JSON.stringify({
      jsonrpc: "2.0", id: JSON.parse(init!.body as string).id,
      result: { structuredContent: { found: true, skill: { id: f1Fixture.id, name: skill.name,
        author_handle: skill.author, description: "", github_url: skill.githubUrl,
        skill_md_path: f1Fixture.path, pinned_install } } },
    }), { headers: { "content-type": "application/json" } }));
    const parsed = await client.skill(f1Fixture.id, new AbortController().signal);
    assert.equal(parsed?.skillMDPath, f1Fixture.path);
    assert.equal(parsed?.hasPinnedInstall, !!pinned_install);
  }
});

test("production entry never supplies the test action", () => {
  const source = readFileSync(new URL("../src/unified-main.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /publicInstallLink|f1InstallLink|VITE_NEWMAC_F1/);
});
