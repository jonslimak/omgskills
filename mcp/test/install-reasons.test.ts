import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { installBlockers } from "../src/install.js";
import { createOmgskillsServer } from "../src/server.js";

const pinned: Skill = { id: "a/b:pdf", name: "pdf", description: "Read PDFs.", install_cmd: "legacy", github_url: "https://github.com/a/b",
  skill_md_path: "skills/pdf/SKILL.md", repo_commit_sha: "a".repeat(40), skill_md_sha: "b".repeat(40) };

test("install blockers distinguish each missing or invalid field without guessing a pin", () => {
  assert.deepEqual(installBlockers(pinned), []);
  for (const [fields, codes] of [
    [{ repo_commit_sha: undefined }, ["missing_commit"]],
    [{ repo_commit_sha: "main" }, ["invalid_commit"]],
    [{ skill_md_sha: undefined }, ["missing_content_hash"]],
    [{ skill_md_sha: "no" }, ["invalid_content_hash"]],
    [{ skill_md_path: "SKILL.md" }, ["invalid_skill_path"]],
    [{ skill_md_path: "../pdf/SKILL.md" }, ["invalid_skill_path"]],
    [{ github_url: "https://evil.example/a/b" }, ["invalid_repository"]],
    [{ install_target_name: "../pdf" }, ["invalid_install_target"]],
    [{ repo_commit_sha: undefined, skill_md_sha: undefined }, ["missing_commit", "missing_content_hash"]]
  ] as [Partial<Skill>, string[]][]) {
    assert.deepEqual(installBlockers({ ...pinned, ...fields }).map(blocker => blocker.code), codes);
  }
});

test("detail and install-plan responses add accurate reasons while summary reads stay compact", async context => {
  const unpinned = { ...pinned, id: "a/b:pdf-missing-hash", skill_md_sha: undefined };
  const library = OmgskillsLibrary.fromData({ skills: [pinned, unpinned], trending: [], goldBasket: [] });
  const server = createOmgskillsServer(library, { paging: true });
  const client = new Client({ name: "install-reasons", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "get_skill", arguments: { id: unpinned.id } });
  const detail = response.structuredContent as any;
  assert.match((response.content as { text: string }[])[0].text, /No SKILL.md verification hash/);
  assert.doesNotMatch((response.content as { text: string }[])[0].text, /no pinned commit/i);
  assert.equal(detail.found, true);
  assert.equal(detail.skill.install_status, "discovery_only");
  assert.equal(detail.skill.install_cmd, undefined);
  assert.equal(detail.skill.discovery_only_reason, "No SKILL.md verification hash is recorded.");
  assert.deepEqual(detail.skill.install_blockers.map((blocker: any) => blocker.code), ["missing_content_hash"]);
  const plan = (await client.callTool({ name: "get_install_plan", arguments: { id: unpinned.id } })).structuredContent as any;
  assert.equal(plan.installable, false);
  assert.match(plan.reason, /No SKILL.md verification hash/);
  assert.doesNotMatch(plan.reason, /No commit/);
  assert.equal(plan.script, undefined);
  assert.deepEqual(plan.install_blockers, detail.skill.install_blockers);
  const summary = (await client.callTool({ name: "get_skills", arguments: { ids: [unpinned.id] } })).structuredContent as any;
  assert.equal(summary.skills[0].discovery_only_reason, undefined);
  const good = (await client.callTool({ name: "get_install_plan", arguments: { id: pinned.id } })).structuredContent as any;
  assert.equal(good.installable, true);
  assert.ok(good.script);
  assert.equal(good.install_blockers, undefined);
});
