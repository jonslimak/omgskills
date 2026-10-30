import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOmgskillsServer } from "../src/server.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { loadCatalogReader, SearchCatalogReader } from "../src/search-catalog.js";
import { catalogFixture, rows } from "./search-catalog-fixture.js";
import type { Skill } from "../src/library.js";

// The shared fixture has a null skill_md_sha that full results reject; real catalog records have none.
const cleanRows = rows.map(({ skill_md_sha, ...row }) => (skill_md_sha === null ? row : { ...row, skill_md_sha })) as Skill[];

type Row = Record<string, unknown> & { id: string };
// Summary rows keep install_status (from the published installable set) but no install metadata.
const detailFields = ["pinned_install", "install_cmd", "skill_md_sha", "skill_md_path", "discovery_only_reason", "install_blockers"];

async function connected(context: { after: (fn: () => unknown) => void }, reader: CatalogReader, paging: boolean) {
  const server = createOmgskillsServer(reader, { paging, ranking: paging }), client = new Client({ name: "summary-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return client;
}
async function skills(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response.content));
  return (response.structuredContent as { skills: Row[]; page?: { nextCursor: string | null } });
}
const listFieldsOf = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !detailFields.includes(key)));

test("summary reads on the compact catalog load no detail shards and match full reads", async context => {
  const f = catalogFixture(context, cleanRows, true);
  const compact = await loadCatalogReader(f.url, { ...f.options, ranking: true }) as SearchCatalogReader;
  const client = await connected(context, compact, true);

  const calls: [string, Record<string, unknown>][] = [
    ["search_skills", { query: "swift", limit: 10 }],
    ["search_skills", { query: "swift", limit: 10, page: {}, ranking: "web-v1" }],
    ["list_trending", { limit: 10 }],
    ["list_trending", { limit: 10, page: {} }],
    ["list_by_author", { author: "example", limit: 10 }],
    ["list_by_author", { author: "example", limit: 10, page: {}, sort: "stars" }],
    ["get_skills", { ids: ["example/skills:swift-review", "another/repo:ui-design", "missing/x:y"] }],
  ];
  for (const [name, args] of calls) {
    const summary = await skills(client, name, { ...args, summary: true });
    assert.equal(compact.diagnostics().detailFetches, 0, `${name} summary fetched detail shards`);
    assert.ok(summary.skills.length > 0, name);
    for (const row of summary.skills) for (const key of detailFields) assert.equal(key in row, false, `${name} returned ${key}`);
    if (name !== "get_skills") assert.ok(summary.skills.every(row => row.install_status === "pinned" || row.install_status === "discovery_only"), `${name} summary rows report install_status`);
  }
  for (const [name, args] of calls) {
    const summary = await skills(client, name, { ...args, summary: true });
    const full = await skills(client, name, { ...args, summary: false });
    assert.deepEqual(summary.skills.map(row => row.id), full.skills.map(row => row.id), name);
    assert.deepEqual(summary.skills, full.skills.map(listFieldsOf), name);
    assert.ok(full.skills.every(row => row.install_status === "pinned" || row.install_status === "discovery_only"), `${name} full rows keep install_status`);
  }
  assert.ok(compact.diagnostics().detailFetches > 0, "full reads still hydrate install metadata");
});

test("summary paging continues with the same cursor contract", async context => {
  const f = catalogFixture(context, cleanRows, true);
  const compact = await loadCatalogReader(f.url, { ...f.options, ranking: true }) as SearchCatalogReader;
  const client = await connected(context, compact, true);
  const first = await skills(client, "search_skills", { query: "swift", limit: 1, page: {}, ranking: "web-v1", summary: true });
  assert.ok(first.page?.nextCursor);
  const second = await skills(client, "search_skills", { query: "swift", limit: 1, page: { cursor: first.page.nextCursor }, ranking: "web-v1", summary: true });
  assert.equal(second.skills.length, 1);
  assert.notEqual(second.skills[0].id, first.skills[0].id);
  assert.equal(compact.diagnostics().detailFetches, 0);
});

test("readers without a summary view still return list fields only", async context => {
  const f = catalogFixture(context, cleanRows);
  const client = await connected(context, f.legacy, false);
  const summary = await skills(client, "search_skills", { query: "swift", summary: true });
  const full = await skills(client, "search_skills", { query: "swift", summary: false });
  assert.deepEqual(summary.skills, full.skills.map(listFieldsOf));
  assert.ok(full.skills.some(row => "install_cmd" in row));
});
