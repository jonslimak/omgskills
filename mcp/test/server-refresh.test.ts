import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { once } from "node:events";
import { createOmgskillsServer, type CatalogProvider } from "../src/server.js";
import { createOmgskillsHttpApp } from "../src/http.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OmgskillsLibrary } from "../src/library.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { rows, trending, goldBasket } from "./search-catalog-fixture.js";

function library(version: string) {
  return OmgskillsLibrary.fromData({
    skills: rows.map(({ skill_md_sha, ...row }) => ({ ...row,
      ...(skill_md_sha ? { skill_md_sha } : {}), description: `${version} Swift design workflow` })),
    trending, goldBasket,
  }, version, { ranking: true });
}

async function connected(context: TestContext, provider: CatalogProvider) {
  const server = createOmgskillsServer(provider, { paging: true, ranking: true,
    fetcher: async () => new Response("# Fixture content") });
  const client = new Client({ name: "refresh-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("all nine tools resolve exactly one current snapshot on each call", async context => {
  let current = library("before");
  let reads = 0;
  const client = await connected(context, () => { reads++; return current; });
  const requests = [
    { name: "search_skills", arguments: { query: "Swift", page: {} } },
    { name: "get_skill", arguments: { id: rows[1].id } },
    { name: "get_skills", arguments: { ids: rows.map(row => row.id) } },
    { name: "list_trending", arguments: { page: {} } },
    { name: "list_gold_basket", arguments: { page: {} } },
    { name: "list_by_author", arguments: { author: "example", page: {} } },
    { name: "related_skills", arguments: { id: rows[1].id, summary: false } },
    { name: "get_install_plan", arguments: { id: rows[0].id } },
    { name: "get_skill_content", arguments: { id: rows[1].id } },
  ];
  for (const version of ["before", "after"]) {
    current = library(version);
    for (const request of requests) {
      reads = 0;
      const result = await client.callTool(request);
      assert.equal(result.isError, undefined, request.name);
      assert.equal(reads, 1, request.name);
      if (request.name === "get_skill") {
        assert.match((result.structuredContent!.skill as { description: string }).description, new RegExp(version));
      }
    }
  }
});

test("a batch already in flight keeps its original catalog through a swap", async context => {
  const original = library("before");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; });
  let current: CatalogReader = {
    getSkill: async id => { started(); await gate; return original.getSkill(id); },
    searchSkills: original.searchSkills.bind(original),
    listTrending: original.listTrending.bind(original),
    listGoldBasket: original.listGoldBasket.bind(original),
    listByAuthor: original.listByAuthor.bind(original),
    getStats: original.getStats.bind(original),
  };
  const client = await connected(context, () => current);
  const pending = client.callTool({ name: "get_skills", arguments: { ids: rows.map(row => row.id), summary: false } });
  await reading;
  current = library("after");
  release();
  const result = await pending;
  const skills = result.structuredContent!.skills as { description: string }[];
  assert.equal(skills.length, rows.length);
  assert.ok(skills.every(skill => skill.description.startsWith("before")));
  const next = await client.callTool({ name: "get_skill", arguments: { id: rows[1].id } });
  assert.match((next.structuredContent!.skill as { description: string }).description, /^after/);
});

test("old cursors fail clearly after replacement, while a fresh first page succeeds", async context => {
  let current = library("before");
  const client = await connected(context, () => current);
  const args = { query: "Swift", limit: 1, page: {} };
  const first = await client.callTool({ name: "search_skills", arguments: args });
  const page = first.structuredContent!.page as { nextCursor: string };
  assert.ok(page.nextCursor);
  current = library("after");
  const old = await client.callTool({ name: "search_skills", arguments: { ...args, page: { cursor: page.nextCursor } } });
  assert.equal(old.isError, true);
  const error = JSON.parse((old.content as { text: string }[])[0].text).error;
  assert.equal(error.code, "catalog_snapshot_changed");
  assert.match(error.message, /Restart from the first page/);
  assert.equal((await client.callTool({ name: "search_skills", arguments: args })).isError, undefined);
});

test("a long-lived local HTTP client observes replacement without reconnecting", async context => {
  let current = library("before");
  const listener = createOmgskillsHttpApp(() => current).listen(0, "127.0.0.1");
  context.after(() => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client({ name: "refresh-http-test", version: "1" });
  context.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
  for (const version of ["before", "after"]) {
    current = library(version);
    const result = await client.callTool({ name: "get_skill", arguments: { id: rows[1].id } });
    assert.match((result.structuredContent!.skill as { description: string }).description, new RegExp(version));
  }
});
