import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";
import { loadCatalogReader, SearchCatalogReader } from "../src/search-catalog.js";
import { catalogFixture } from "./search-catalog-fixture.js";

const description = "Review design carefully.\n".repeat(300);
const rows: Skill[] = Array.from({ length: 20 }, (_, i) => ({ id: `example/skills:design-${i}`, name: `design-${i}`, description,
  github_url: "https://github.com/example/skills", install_cmd: "legacy", author_handle: "example", stars: i }));

test("all summary list tools bound structured descriptions; full reads preserve the source", async context => {
  const library = OmgskillsLibrary.fromData({ skills: rows, trending: rows.map((row, i) => ({ id: row.id, trending_rank: i + 1 })),
    goldBasket: rows.map(row => ({ ...row, score: 1 })) });
  const server = createOmgskillsServer(library, { paging: true });
  const client = new Client({ name: "response-size", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  for (const [name, args] of [
    ["search_skills", { query: "design" }], ["list_trending", {}], ["list_gold_basket", {}],
    ["list_by_author", { author: "example" }], ["get_skills", { ids: rows.map(row => row.id) }],
    ["related_skills", { id: rows[0].id }]
  ] as [string, Record<string, unknown>][]) {
    const summary = await client.callTool({ name, arguments: args });
    const value = summary.structuredContent as { skills: Record<string, any>[] };
    assert.ok(value.skills.length, name);
    assert.ok(value.skills.every(row => row.description.length <= 160 && row.description_truncated === true), name);
    const full = await client.callTool({ name, arguments: { ...args, summary: false } });
    assert.ok((full.structuredContent as typeof value).skills.every(row => row.description === description && row.description_truncated === undefined), name);
    assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 4, name);
    assert.doesNotMatch((summary.content as { text: string }[])[0].text, /"skills":/);
    if (name === "search_skills") assert.equal(value.skills.length, 10, "default limit stays 10");
  }
  const detail = await client.callTool({ name: "get_skill", arguments: { id: rows[0].id } });
  assert.equal((detail.structuredContent as any).skill.description, description);
});

test("compact summary reads truncate without fetching detail shards or splitting Unicode", async context => {
  const emoji = "\u{1f600}".repeat(200);
  const f = catalogFixture(context, [{ ...rows[0], description: emoji }]);
  const reader = await loadCatalogReader(f.url, f.options) as SearchCatalogReader;
  const server = createOmgskillsServer(reader, { paging: true });
  const client = new Client({ name: "response-size", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "search_skills", arguments: { query: "design" } });
  const row = (response.structuredContent as any).skills[0];
  assert.equal(Array.from(row.description).length, 160);
  assert.equal(row.description, "\u{1f600}".repeat(157) + "...");
  assert.equal(reader.diagnostics().detailFetches, 0);
});
