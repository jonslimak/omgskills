import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";
import { gitBlobSha } from "../src/install.js";

const content = "Read the skill before installing.\n".repeat(500);
const skills: Skill[] = Array.from({ length: 35 }, (_, index) => ({
  id: `example/skills:skill-${index}`,
  name: `design-${index}`,
  description: "Example skill for compatibility checks.",
  github_url: "https://github.com/example/skills",
  install_cmd: "legacy command",
  author_handle: "example",
  stars: 100 - index,
  repo_commit_sha: "a".repeat(40),
  skill_md_path: `skill-${index}/SKILL.md`,
  skill_md_sha: gitBlobSha(new TextEncoder().encode(content))
}));

async function connect(context: { after: (fn: () => unknown) => void }) {
  const library = OmgskillsLibrary.fromData({
    skills,
    trending: skills.map((skill, index) => ({ id: skill.id, trending_rank: index + 1 })),
    goldBasket: skills.map((skill, index) => ({ ...skill, score: 100 - index }))
  }, "a".repeat(64), { ranking: true });
  const server = createOmgskillsServer(library, {
    paging: true, ranking: true, fetcher: (async () => new Response(content)) as typeof fetch
  });
  const client = new Client({ name: "zod-migration-check", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("tool schemas preserve required fields, optional defaults and strict inputs", async context => {
  const client = await connect(context);
  const { tools } = await client.listTools();
  const required: Record<string, string[]> = {
    search_skills: [], get_skill: ["id"], get_skills: ["ids"], list_trending: [], list_gold_basket: [],
    list_by_author: ["author"], related_skills: ["id"], get_install_plan: ["id"], get_skill_content: ["id"]
  };
  for (const tool of tools) {
    assert.deepEqual(tool.inputSchema.required ?? [], required[tool.name], tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }
  const properties = (name: string) => tools.find(tool => tool.name === name)!.inputSchema.properties as Record<string, { default?: unknown }>;
  for (const name of ["search_skills", "list_trending", "list_gold_basket", "list_by_author"]) {
    assert.equal(properties(name).limit.default, 10, name);
    assert.equal(properties(name).summary.default, true, name);
  }
  assert.equal(properties("search_skills").query.default, "");
  assert.equal(properties("related_skills").limit.default, 5);
  assert.equal(properties("get_install_plan").agent.default, "claude_code");
  assert.equal(properties("get_install_plan").scope.default, "user");
  assert.equal(properties("get_skill_content").max_chars.default, 12000);
});

test("omitted arguments retain compact results, paging and install/content defaults", async context => {
  const client = await connect(context);
  for (const [name, args] of [
    ["search_skills", {}], ["list_trending", {}], ["list_gold_basket", {}], ["list_by_author", { author: "example" }]
  ] as const) {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, name);
    const data = response.structuredContent as { count: number; skills: Record<string, unknown>[]; page?: { total: number } };
    assert.equal(data.count, 10, name);
    assert.ok(data.skills.every(skill => !("install_status" in skill) && !("install_cmd" in skill)), name);
    if (name !== "list_gold_basket") assert.equal(data.page?.total, 35, name);
  }
  const full = await client.callTool({ name: "search_skills", arguments: { query: "example", summary: false } });
  assert.equal((full.structuredContent!.skills as { install_status: string }[])[0].install_status, "pinned");
  const related = await client.callTool({ name: "related_skills", arguments: { id: skills[0].id } });
  assert.equal(related.structuredContent?.count, 5);
  const plan = await client.callTool({ name: "get_install_plan", arguments: { id: skills[0].id } });
  assert.equal(plan.structuredContent?.agent, "claude_code");
  assert.equal(plan.structuredContent?.scope, "user");
  assert.equal(plan.structuredContent?.installable, true);
  const read = await client.callTool({ name: "get_skill_content", arguments: { id: skills[0].id } });
  assert.equal(read.structuredContent?.verified, true);
  assert.equal(read.structuredContent?.truncated, true);
  assert.equal((read.structuredContent?.content as string).length, 12000);
  const missing = await client.callTool({ name: "get_skill_content", arguments: { id: "missing/repo:skill" } });
  assert.deepEqual(missing.structuredContent, { found: false });
});

test("invalid values and unknown keys remain rejected without coercion", async context => {
  const client = await connect(context);
  const invalid = [
    { name: "get_skill", arguments: {} },
    { name: "get_skill", arguments: { id: "x".repeat(501) } },
    { name: "get_skill", arguments: { id: 42 } },
    { name: "get_skills", arguments: { ids: [] } },
    { name: "get_skills", arguments: { ids: Array(31).fill(skills[0].id) } },
    { name: "search_skills", arguments: { limit: 0 } },
    { name: "search_skills", arguments: { limit: 1.5 } },
    { name: "search_skills", arguments: { limit: 101 } },
    { name: "search_skills", arguments: { limit: "10" } },
    { name: "search_skills", arguments: { summary: "false" } },
    { name: "search_skills", arguments: { unknown: true } },
    { name: "search_skills", arguments: { page: { cursor: "x", unknown: true } } },
    { name: "get_install_plan", arguments: { id: skills[0].id, agent: "other" } },
    { name: "get_install_plan", arguments: { id: skills[0].id, scope: "other" } },
    { name: "get_skill_content", arguments: { id: skills[0].id, max_chars: 499 } },
    { name: "get_skill_content", arguments: { id: skills[0].id, max_chars: 60001 } }
  ];
  for (const request of invalid) {
    const response = await client.callTool(request);
    assert.equal(response.isError, true, JSON.stringify(request));
    assert.match(JSON.stringify(response.content), /Invalid arguments/);
  }
  const valid = await client.callTool({ name: "get_skills", arguments: { ids: skills.slice(0, 30).map(skill => skill.id) } });
  assert.notEqual(valid.isError, true);
  assert.equal(valid.structuredContent?.count, 30);
});
