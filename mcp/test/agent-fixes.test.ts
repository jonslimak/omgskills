import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type LoadedLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";
import { gitBlobSha } from "../src/install.js";

const skillMd = "---\nname: swiftui-pro\ndescription: Write modern SwiftUI.\n---\n\nUse NavigationStack.\n";
const commit = "a".repeat(40), mdSha = gitBlobSha(new TextEncoder().encode(skillMd));
const skill = (id: string, extra: Partial<Skill>): Skill => ({ id, name: id.split(":").at(-1)!.split("/").at(-1)!, description: "", github_url: `https://github.com/${id.split(":")[0]}`,
  install_cmd: "git clone x /tmp/x", author_handle: id.split("/")[0], ...extra });
const data: LoadedLibrary = {
  skills: [
    skill("twostraws/swiftui-agent-skill:swiftui-pro", { description: "Write modern SwiftUI apps.", stars: 6210,
      skill_md_path: "swiftui-pro/SKILL.md", skill_md_sha: mdSha, repo_commit_sha: commit }),
    skill("twostraws/SwiftUI-Agent-Skill:swiftui-pro/skills/swiftui-pro", { name: "swiftui-pro", description: "Duplicate path.", stars: 4467 }),
    skill("yusufkaran/swiftui-autotest-skill", { name: "swiftui-autotest-skill", description: "Test SwiftUI views.", stars: 23 }),
    skill("affaan-m/ecc:react-performance", { description: "Make React apps faster: memoization and profiling.", stars: 282851,
      skill_md_path: "skills/react-performance/SKILL.md", skill_md_sha: "b".repeat(40) }),
    skill("dimillian/skills:react-component-performance", { description: "Profile slow React components.", stars: 3922,
      skill_md_path: "react-component-performance/SKILL.md", skill_md_sha: "c".repeat(40), repo_commit_sha: "d".repeat(40) }),
    skill("anthropics/skills:pdf", { description: "Read and create PDF files.", stars: 182853 }),
  ],
  trending: [{ id: "anthropics/skills:pdf", trending_rank: 1 }, { id: "affaan-m/ecc:react-performance", trending_rank: 2 }],
  goldBasket: []
};

async function client(context: { after: (fn: () => unknown) => void }, fetcher?: typeof fetch) {
  const server = createOmgskillsServer(OmgskillsLibrary.fromData(data, "v1", { ranking: true }), { paging: true, ranking: true, fetcher });
  const connected = new Client({ name: "agent-fixes", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await connected.connect(a);
  context.after(async () => { await connected.close(); await server.close(); });
  return connected;
}
const ids = (value: unknown) => (value as { skills: { id: string }[] }).skills.map(row => row.id);
const text = (response: { content: unknown }) => (response.content as { text: string }[])[0].text;

test("IDs and author handles are forgiving", () => {
  const library = OmgskillsLibrary.fromData(data);
  assert.equal(library.getSkill("TwoStraws/SwiftUI-Agent-Skill:SwiftUI-Pro")?.id, "twostraws/swiftui-agent-skill:swiftui-pro");
  assert.equal(library.getSkill("catalog:anthropics/skills:pdf")?.id, "anthropics/skills:pdf");
  assert.equal(library.getSkill("  anthropics/skills:pdf ")?.id, "anthropics/skills:pdf");
  assert.deepEqual(library.listByAuthor("@Anthropics").map(row => row.id), ["anthropics/skills:pdf"]);
  assert.equal(library.getSkill("anthropics/skills:missing"), undefined);
});

test("search ranks popular exact matches first, fixes typos, handles tasks and empty queries", () => {
  const library = OmgskillsLibrary.fromData(data);
  assert.equal(library.searchSkills({ query: "swiftui" })[0].id, "twostraws/swiftui-agent-skill:swiftui-pro");
  assert.ok(library.searchSkills({ query: "swift ui" }).some(row => row.id === "twostraws/swiftui-agent-skill:swiftui-pro"));
  const typo = library.searchWithNote({ query: "reactt perfomance" });
  assert.equal(typo.note?.did_you_mean, "react performance");
  assert.equal(typo.skills[0].id, "affaan-m/ecc:react-performance");
  const task = library.searchWithNote({ query: "help me make my react app faster" });
  assert.equal(task.note?.partial_match, true);
  assert.equal(task.skills[0].id, "affaan-m/ecc:react-performance");
  const empty = library.searchWithNote({ query: "" });
  assert.deepEqual(empty.note, { showing_trending: true });
  assert.deepEqual(empty.skills.map(row => row.id), ["anthropics/skills:pdf", "affaan-m/ecc:react-performance"]);
  assert.deepEqual(library.searchWithNote({ query: "zzzzqqq" }), { note: undefined, skills: [] });
});

test("lists are compact by default and page with totals", async context => {
  const mcp = await client(context);
  const search = await mcp.callTool({ name: "search_skills", arguments: { query: "swiftui" } });
  const value = search.structuredContent as { skills: Record<string, unknown>[]; page: { total: number } };
  assert.equal(value.page.total, 3);
  assert.ok(value.skills.every(row => !("install_status" in row) && !("install_cmd" in row)));
  assert.match(text(search), /^3 skills of 3:\n- twostraws\/swiftui-agent-skill:swiftui-pro \[6\.2K stars\]: Write modern SwiftUI apps\./);
  const typo = await mcp.callTool({ name: "search_skills", arguments: { query: "reactt perfomance" } });
  assert.deepEqual((typo.structuredContent as { search: unknown }).search, { did_you_mean: "react performance" });
  assert.match(text(typo), /showing results for "react performance"/);
  const batch = await mcp.callTool({ name: "get_skills", arguments: { ids: ["ANTHROPICS/skills:pdf", "nope/x:y"] } });
  assert.deepEqual(ids(batch.structuredContent), ["anthropics/skills:pdf"]);
  assert.deepEqual((batch.structuredContent as { missing: string[] }).missing, ["nope/x:y"]);
});

test("get_skill returns install scripts for pinned skills and no query score", async context => {
  const mcp = await client(context);
  const pinned = (await mcp.callTool({ name: "get_skill", arguments: { id: "catalog:twostraws/swiftui-agent-skill:swiftui-pro" } })).structuredContent as { skill: Record<string, any> };
  assert.equal(pinned.skill.install_status, "pinned");
  assert.equal("score" in pinned.skill, false);
  assert.match(pinned.skill.install.claude_code, /~\/\.claude\/skills\/swiftui-pro/);
  assert.match(pinned.skill.install.codex, /~\/\.codex\/skills\/swiftui-pro/);
  const missing = await mcp.callTool({ name: "get_skill", arguments: { id: "twostraws/swiftui-agent-skill:swiftui-prp" } });
  assert.deepEqual(missing.structuredContent, { found: false, skill: null });
  assert.match(text(missing), /Did you mean: .*swiftui-pro/);
});

test("install plans pin the commit, verify SKILL.md and never overwrite or use /tmp paths", async context => {
  const mcp = await client(context);
  const plan = (await mcp.callTool({ name: "get_install_plan", arguments: { id: "twostraws/swiftui-agent-skill:swiftui-pro", agent: "codex", scope: "project" } })).structuredContent as Record<string, any>;
  assert.equal(plan.installable, true);
  assert.equal(plan.destination, ".codex/skills/swiftui-pro");
  assert.match(plan.script, new RegExp(`fetch -q --depth 1 https://github.com/twostraws/swiftui-agent-skill.git ${commit}`));
  assert.match(plan.script, new RegExp(`rev-parse HEAD:swiftui-pro/SKILL.md\\)" = ${mdSha}`));
  assert.match(plan.script, /test ! -e \.codex\/skills\/swiftui-pro/);
  assert.doesNotMatch(plan.script, /\/tmp\/|ln -s/);
  const unpinned = (await mcp.callTool({ name: "get_install_plan", arguments: { id: "affaan-m/ecc:react-performance" } })).structuredContent as Record<string, any>;
  assert.equal(unpinned.installable, false);
  assert.match(unpinned.reason, /No commit is recorded/);
  assert.deepEqual(unpinned.alternatives.map((row: { id: string }) => row.id), ["dimillian/skills:react-component-performance"]);
});

test("related skills skip the skill itself and its copies", async context => {
  const mcp = await client(context);
  const related = await mcp.callTool({ name: "related_skills", arguments: { id: "twostraws/swiftui-agent-skill:swiftui-pro" } });
  assert.deepEqual(ids(related.structuredContent), ["yusufkaran/swiftui-autotest-skill"]);
  assert.equal((await mcp.callTool({ name: "related_skills", arguments: { id: "nope/x:y" } })).isError, true);
});

test("get_skill_content reads SKILL.md at the pinned commit and checks its hash", async context => {
  const requested: string[] = [];
  const fetcher = (async (url: string) => {
    requested.push(url);
    if (url.includes("react-performance")) return new Response("changed", { status: 200 });
    if (url.includes("pdf")) return new Response("missing", { status: 404 });
    return new Response(skillMd, { status: 200 });
  }) as unknown as typeof fetch;
  const mcp = await client(context, fetcher);
  const pinned = await mcp.callTool({ name: "get_skill_content", arguments: { id: "twostraws/swiftui-agent-skill:swiftui-pro", max_chars: 500 } });
  assert.deepEqual(pinned.structuredContent, { found: true, id: "twostraws/swiftui-agent-skill:swiftui-pro", path: "swiftui-pro/SKILL.md", ref: commit,
    pinned: true, verified: true, truncated: false, content: skillMd });
  assert.equal(requested[0], `https://raw.githubusercontent.com/twostraws/swiftui-agent-skill/${commit}/swiftui-pro/SKILL.md`);
  const head = (await mcp.callTool({ name: "get_skill_content", arguments: { id: "affaan-m/ecc:react-performance" } })).structuredContent as Record<string, unknown>;
  assert.equal(head.ref, "HEAD"); assert.equal(head.pinned, false); assert.equal(head.verified, false);
  const none = await mcp.callTool({ name: "get_skill_content", arguments: { id: "anthropics/skills:pdf" } });
  assert.equal(none.isError, true); assert.match(text(none), /no recorded SKILL\.md location/);
});
