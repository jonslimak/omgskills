import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "node:http";
import { createOmgskillsHttpApp } from "../src/http.js";
import { OmgskillsLibrary, type LoadedLibrary } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";

const fixtureData: LoadedLibrary = {
  skills: [
    {
      id: "anthropics/skills:swift-review",
      name: "swift-review",
      description: "Review Swift code for correctness and modern concurrency practices.",
      github_url: "https://github.com/anthropics/skills",
      install_cmd: "npx skills add anthropics/skills --skill swift-review",
      author_handle: "Anthropics",
      tags: ["swift", "review"],
      stars: 1200
    },
    {
      id: "openai/codex:mcp-builder",
      name: "mcp-builder",
      description: "Build and review Model Context Protocol servers and tools.",
      github_url: "https://github.com/openai/codex",
      install_cmd: "npx skills add openai/codex --skill mcp-builder",
      author_handle: "openai",
      tags: ["mcp", "typescript"],
      stars: 900
    }
  ],
  trending: [
    { id: "openai/codex:mcp-builder", installs: 4200, trending_rank: 1 }
  ],
  goldBasket: [
    {
      id: "anthropics/skills:swift-review",
      name: "swift-review",
      description: "Review Swift code for correctness and modern concurrency practices.",
      github_url: "https://github.com/anthropics/skills",
      install_cmd: "npx skills add anthropics/skills --skill swift-review",
      author_handle: "Anthropics",
      tags: ["swift", "review"],
      stars: 1200,
      score: 98,
      installs: null,
      trending_rank: null,
      niche: null
    }
  ]
};

test("tools expose complete read-only metadata and structured results", async (context) => {
  const library = OmgskillsLibrary.fromData(fixtureData);
  const server = createOmgskillsServer(library);
  const client = new Client({ name: "omgskills-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  assert.match(client.getInstructions() ?? "", /All tools are read-only/);
  assert.match(client.getInstructions() ?? "", /If install_status is discovery_only, do not install/);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "search_skills",
    "get_skill",
    "get_skills",
    "list_trending",
    "list_gold_basket",
    "list_by_author"
  ]);

  for (const tool of tools) {
    assert.ok(tool.title);
    assert.ok(tool.description);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema?.type, "object");
  }

  const search = await client.callTool({
    name: "search_skills",
    arguments: { query: "swift", limit: 5 }
  });
  assert.equal(search.isError, undefined);
  assert.equal(search.structuredContent?.count, 1);
  assert.equal((search.structuredContent?.skills as Array<{ id: string }>)[0]?.id, "anthropics/skills:swift-review");
  assert.equal((search.structuredContent?.skills as Array<{ install_status: string }>)[0]?.install_status, "discovery_only");
  assert.equal("pinned_install" in (search.structuredContent?.skills as object[])[0], false);

  const missing = await client.callTool({
    name: "get_skill",
    arguments: { id: "missing/repo:missing" }
  });
  assert.deepEqual(missing.structuredContent, { found: false, skill: null });

  const batch = await client.callTool({ name: "get_skills", arguments: {
    ids: ["openai/codex:mcp-builder", "missing/repo:missing", "anthropics/skills:swift-review", "openai/codex:mcp-builder"]
  } });
  assert.equal(batch.isError, undefined);
  assert.deepEqual((batch.structuredContent?.skills as Array<{ id: string }>).map(skill => skill.id),
    ["openai/codex:mcp-builder", "anthropics/skills:swift-review"]);

  const byAuthor = await client.callTool({
    name: "list_by_author",
    arguments: { author: "ANTHROPICS", limit: 5 }
  });
  assert.equal(byAuthor.isError, undefined);
  assert.equal(byAuthor.structuredContent?.count, 1);
  const authorSkill = (byAuthor.structuredContent?.skills as Array<Record<string, unknown>>)[0];
  assert.equal(authorSkill.installs, undefined);
  assert.equal(authorSkill.trending_rank, undefined);
  assert.equal(authorSkill.niche, undefined);
});

test("strict clients accept real catalog records without undeclared fields", async (context) => {
  const skill = {
    ...fixtureData.skills[0],
    publisher_handle: "anthropics",
    repo_commit_sha: "a".repeat(40),
    skill_tree_sha: "b".repeat(40),
    skill_md_path: "skills/swift-review/SKILL.md",
    skill_md_sha: "c".repeat(40),
    readme_snippet: "Internal catalog metadata"
  };
  const library = OmgskillsLibrary.fromData({
    skills: [skill],
    trending: [{ id: skill.id, installs: 10, trending_rank: 1 }],
    goldBasket: [{ ...skill, score: 98 }]
  });
  const server = createOmgskillsServer(library);
  const client = new Client({ name: "omgskills-strict-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const calls = [
    { name: "search_skills", arguments: { query: "swift" } },
    { name: "get_skill", arguments: { id: skill.id } },
    { name: "get_skills", arguments: { ids: [skill.id] } },
    { name: "list_trending", arguments: {} },
    { name: "list_gold_basket", arguments: {} },
    { name: "list_by_author", arguments: { author: "anthropics" } }
  ];
  for (const call of calls) {
    const response = await client.callTool(call);
    assert.equal(response.isError, undefined, call.name);
    const publicSkill = call.name === "get_skill"
      ? response.structuredContent?.skill
      : (response.structuredContent?.skills as unknown[])[0];
    assert.ok(publicSkill && typeof publicSkill === "object", call.name);
    assert.equal((publicSkill as { id: string }).id, skill.id);
    assert.equal("publisher_handle" in publicSkill, false);
    assert.equal("repo_commit_sha" in publicSkill, false);
    assert.equal("skill_tree_sha" in publicSkill, false);
    assert.equal((publicSkill as { install_status: string }).install_status, "pinned");
    assert.deepEqual((publicSkill as { pinned_install: unknown }).pinned_install, {
      repo: "anthropics/skills",
      path: "skills/swift-review",
      commit_sha: "a".repeat(40),
      skill_md_sha: "c".repeat(40),
      skill_tree_sha: "b".repeat(40)
    });
    assert.doesNotMatch(JSON.stringify(response.content), /readme_snippet|Internal catalog metadata/);
  }
});

test("invalid or incomplete pin metadata never yields an install plan", async (context) => {
  const invalid = {
    ...fixtureData.skills[0],
    repo_commit_sha: "a".repeat(40),
    skill_md_sha: "c".repeat(40),
    skill_md_path: "../swift-review/SKILL.md"
  };
  const library = OmgskillsLibrary.fromData({ skills: [invalid], trending: [], goldBasket: [] });
  const server = createOmgskillsServer(library);
  const client = new Client({ name: "omgskills-invalid-pin-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  context.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({ name: "get_skill", arguments: { id: invalid.id } });
  const skill = response.structuredContent?.skill as Record<string, unknown>;
  assert.equal(skill.install_status, "discovery_only");
  assert.equal("pinned_install" in skill, false);
});

test("local Streamable HTTP transport initializes and calls tools", async (context) => {
  const app = createOmgskillsHttpApp(OmgskillsLibrary.fromData(fixtureData));
  const httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  context.after(() => closeHttpServer(httpServer));

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: "omgskills-http-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  context.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);

  const result = await client.callTool({
    name: "list_trending",
    arguments: { limit: 1 }
  });
  assert.equal(result.structuredContent?.count, 1);

  assert.equal((await fetch(endpoint, { method: "GET" })).status, 405);
  assert.equal((await fetch(endpoint, { method: "DELETE" })).status, 405);
});

test("published stdio entry point still exposes the shared tools", async (context) => {
  const fixtureDirectory = resolve("test/fixtures");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    cwd: process.cwd(),
    env: {
      OMGSKILLS_SKILLS_PATH: resolve(fixtureDirectory, "skills.json"),
      OMGSKILLS_TRENDING_PATH: resolve(fixtureDirectory, "trending.json"),
      OMGSKILLS_GOLD_BASKET_PATH: resolve(fixtureDirectory, "gold-basket.json")
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "omgskills-stdio-test", version: "1.0.0" });
  await client.connect(transport);
  context.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);

  const result = await client.callTool({
    name: "get_skill",
    arguments: { id: "openai/codex:mcp-builder" }
  });
  assert.equal(result.structuredContent?.found, true);
});

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

test("library keeps only returnable fields and ranks with precomputed search data", () => {
  const library = OmgskillsLibrary.fromData({
    skills: [
      { id: "a/x:first", name: "pdf-tools", description: "Work with PDF files.", github_url: "https://github.com/a/x", install_cmd: "x", author_handle: "Acme", stars: 10, readme_snippet: "internal" } as never,
      { id: "a/x:second", name: "pdf-tools", description: "Work with PDF files.", github_url: "https://github.com/a/x", install_cmd: "x", author_handle: "acme", stars: 10 },
      { id: "b/y:other", name: "spreadsheet", description: "Edit sheets.", github_url: "https://github.com/b/y", install_cmd: "y", author_handle: "beta", stars: 500 }
    ],
    trending: [],
    goldBasket: []
  });

  assert.equal("readme_snippet" in (library.getSkill("a/x:first") ?? {}), false);
  assert.deepEqual(library.searchSkills({ query: "PDF" }).map((skill) => skill.id), ["a/x:first", "a/x:second"]);
  assert.deepEqual(library.listByAuthor("ACME").map((skill) => skill.id), ["a/x:first", "a/x:second"]);
  assert.deepEqual(library.searchSkills({ query: "", minStars: 100 }).map((skill) => skill.id), ["b/y:other"]);
});
