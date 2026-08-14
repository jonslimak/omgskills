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
      score: 98
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

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "search_skills",
    "get_skill",
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

  const missing = await client.callTool({
    name: "get_skill",
    arguments: { id: "missing/repo:missing" }
  });
  assert.deepEqual(missing.structuredContent, { found: false, skill: null });

  const byAuthor = await client.callTool({
    name: "list_by_author",
    arguments: { author: "ANTHROPICS", limit: 5 }
  });
  assert.equal(byAuthor.structuredContent?.count, 1);
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
  assert.equal(tools.length, 5);

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
  assert.equal(tools.length, 5);

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
