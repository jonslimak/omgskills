import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";

const rows: Skill[] = Array.from({ length: 12 }, (_, i) => ({ id: `example/skills:design-${i}`, name: `design-${i}`,
  description: "Design workflows.", install_cmd: "", github_url: "https://github.com/example/skills", author_handle: "example", stars: i }));

test("documented tools match strict read-only protocol schemas and not-found shapes", async context => {
  const server = createOmgskillsServer(OmgskillsLibrary.fromData({ skills: rows, trending: [], goldBasket: [] }), { paging: true });
  const client = new Client({ name: "tool-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const documented = [...readme.matchAll(/^### `([a-z_]+)`$/gm)].map(match => match[1]);
  assert.deepEqual(tools.map(tool => tool.name).sort(), documented.sort());
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    const unknown = await client.callTool({ name: tool.name, arguments: { bogus: true } });
    assert.equal(unknown.isError, true, tool.name);
  }
  for (const name of ["get_skill", "get_install_plan", "get_skill_content", "related_skills"]) {
    const response = await client.callTool({ name, arguments: { id: "unknown/repo:missing" } });
    assert.notEqual(response.isError, true, name);
    assert.equal((response.structuredContent as any).found, false, name);
  }
  const batch = await client.callTool({ name: "get_skills", arguments: { ids: [rows[0].id, "unknown/repo:missing"] } });
  assert.deepEqual((batch.structuredContent as any).missing, ["unknown/repo:missing"]);
});

test("sort works without page; cursor errors explain recovery and preserve error codes", async context => {
  let library = OmgskillsLibrary.fromData({ skills: rows, trending: [], goldBasket: [] }, "snapshot-one");
  const server = createOmgskillsServer(() => library, { paging: true });
  const client = new Client({ name: "paging-recovery", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const args = { author: "example", sort: "stars", limit: 2 };
  const first = await client.callTool({ name: "list_by_author", arguments: args });
  assert.notEqual(first.isError, true);
  const page = (first.structuredContent as any).page;
  assert.equal(page.total, rows.length); assert.equal(page.hasMore, true); assert.ok(page.nextCursor);
  assert.equal((first.content as { text: string }[])[0].text.startsWith("2 skills of 12:"), true);
  for (const [changed, message] of [
    [{ ...args, limit: 3, page: { cursor: page.nextCursor } }, /original query, filters, limit and sort/],
    [{ ...args, page: { cursor: "bad-cursor" } }, /Start again with page: \{\}/]
  ] as [Record<string, unknown>, RegExp][]) {
    const response = await client.callTool({ name: "list_by_author", arguments: changed });
    assert.equal(response.isError, true);
    const error = JSON.parse((response.content as { text: string }[])[0].text).error;
    assert.equal(error.code, "invalid_cursor"); assert.match(error.message, message);
  }
  library = OmgskillsLibrary.fromData({ skills: rows, trending: [], goldBasket: [] }, "snapshot-two");
  const changed = await client.callTool({ name: "list_by_author", arguments: { ...args, page: { cursor: page.nextCursor } } });
  assert.equal(changed.isError, true);
  const error = JSON.parse((changed.content as { text: string }[])[0].text).error;
  assert.equal(error.code, "catalog_snapshot_changed"); assert.match(error.message, /Restart from the first page/);
});
