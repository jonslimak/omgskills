import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { createOmgskillsServer } from "../src/server.js";
import { installScript } from "../src/install.js";
import { loadCatalogReader } from "../src/search-catalog.js";
import { encodeInstallable, installablePayload } from "../src/search-catalog-format.mjs";
import { catalogFixture, rows } from "./search-catalog-fixture.js";

const cleanRows = rows.map(({ skill_md_sha, ...row }) => (skill_md_sha === null ? row : { ...row, skill_md_sha })) as Skill[];
const pinned = { skill_md_path: "x/SKILL.md", skill_md_sha: "c".repeat(40), repo_commit_sha: "a".repeat(40) };
const skill = (id: string, stars: number, description: string, extra: Partial<Skill> = {}): Skill => ({ id, name: id.split(":")[1], description,
  github_url: `https://github.com/${id.split(":")[0]}`, install_cmd: "", author_handle: id.split("/")[0], stars, ...extra });

async function connect(context: { after: (fn: () => unknown) => void }, reader: CatalogReader) {
  const server = createOmgskillsServer(reader, { paging: true, ranking: true });
  const client = new Client({ name: "installable", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return client;
}
type Rows = { skills: { id: string; install_status?: string }[]; page?: { total: number; nextCursor: string | null } };
const value = (response: { structuredContent?: unknown }) => response.structuredContent as Rows;
const text = (response: { content: unknown }) => (response.content as { text: string }[])[0].text;

test("the compact catalog publishes which skills are installable and filters on it", async context => {
  const f = catalogFixture(context, cleanRows, true);
  const client = await connect(context, await loadCatalogReader(f.url, { ...f.options, ranking: true }));
  const all = value(await client.callTool({ name: "search_skills", arguments: { query: "swift" } }));
  assert.deepEqual(all.skills.map(row => [row.id, row.install_status]),
    [["example/skills:swift-review", "pinned"], ["example/skills:root", "discovery_only"]]);
  for (const args of [{ query: "swift" }, { query: "swift", ranking: "web-v1", page: {} }, { query: "design", sort: "stars" }]) {
    const only = value(await client.callTool({ name: "search_skills", arguments: { ...args, installable: true } }));
    assert.deepEqual(only.skills.map(row => row.id), ["example/skills:swift-review"], JSON.stringify(args));
    assert.equal(only.page?.total, 1);
  }
  // An empty query with the filter lists every installable skill instead of trending.
  assert.deepEqual(value(await client.callTool({ name: "search_skills", arguments: { installable: true } })).skills.map(row => row.id), ["example/skills:swift-review"]);
});

test("a catalog without the installable set says so instead of guessing", async context => {
  const library = OmgskillsLibrary.fromData({ skills: [skill("a/b:pdf", 5, "PDF tools", pinned)], trending: [], goldBasket: [] }, "v1", { installableIds: null });
  const client = await connect(context, library);
  const rows = value(await client.callTool({ name: "search_skills", arguments: { query: "pdf" } }));
  assert.equal("install_status" in rows.skills[0], false);
  const filtered = await client.callTool({ name: "search_skills", arguments: { query: "pdf", installable: true } });
  assert.equal(filtered.isError, true);
  assert.match(text(filtered), /installable_not_supported/);
});

test("installable bitsets round-trip and reject the wrong length or stray bits", () => {
  const source = { sourceSkills: { sha256: "f".repeat(64) }, skillCount: 10 } as never;
  const ids = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }));
  const payload = { schemaVersion: 1, sourceSkillsSha256: "f".repeat(64), skillCount: 10, pinned: encodeInstallable(ids.map((_, i) => i % 3 === 0)) };
  assert.deepEqual([...installablePayload(payload, source, ids)], ["s0", "s3", "s6", "s9"]);
  assert.throws(() => installablePayload({ ...payload, pinned: encodeInstallable([true]) }, source, ids));
  assert.throws(() => installablePayload({ ...payload, pinned: Buffer.from([0, 0xff]).toString("base64") }, source, ids));
  assert.throws(() => installablePayload({ ...payload, extra: 1 }, source, ids));
});

test("related skills put skills named for the job first, then the most-starred, and can require installable", async context => {
  const library = OmgskillsLibrary.fromData({ skills: [
    skill("base/x:react-performance", 10, "Make React faster."),
    skill("small/y:react-performance-tips", 3, "React performance react performance react performance."),
    skill("big/z:react-performance-guide", 9000, "React performance guide."),
    skill("pin/w:react-performance-kit", 50, "React performance kit.", pinned),
    skill("huge/v:everything", 99000, "Many skills, including react performance tuning."),
  ], trending: [], goldBasket: [] }, "v1");
  const client = await connect(context, library);
  const related = value(await client.callTool({ name: "related_skills", arguments: { id: "base/x:react-performance" } }));
  // A mention in another skill's description ranks after skills named for the job, however popular.
  assert.deepEqual(related.skills.map(row => row.id), ["big/z:react-performance-guide", "pin/w:react-performance-kit", "small/y:react-performance-tips", "huge/v:everything"]);
  const installable = value(await client.callTool({ name: "related_skills", arguments: { id: "base/x:react-performance", installable: true } }));
  assert.deepEqual(installable.skills.map(row => row.id), ["pin/w:react-performance-kit"]);
});

test("list_gold_basket pages", async context => {
  const f = catalogFixture(context, cleanRows, true);
  const client = await connect(context, await loadCatalogReader(f.url, { ...f.options, ranking: true }));
  const first = value(await client.callTool({ name: "list_gold_basket", arguments: { limit: 1 } }));
  assert.equal(first.page?.total, 2);
  const second = value(await client.callTool({ name: "list_gold_basket", arguments: { limit: 1, page: { cursor: first.page!.nextCursor! } } }));
  assert.notEqual(second.skills[0].id, first.skills[0].id);
  assert.equal(second.page?.nextCursor, null);
});

test("an over-long query reports one error, with the limit in the schema", async context => {
  const client = await connect(context, OmgskillsLibrary.fromData({ skills: [], trending: [], goldBasket: [] }, "v1"));
  const response = await client.callTool({ name: "search_skills", arguments: { query: "x".repeat(1001) } });
  assert.equal(response.isError, true);
  assert.equal(text(response).match(/query is too long/g)?.length, 1);
  const tools = await client.listTools();
  const query = tools.tools.find(tool => tool.name === "search_skills")!.inputSchema.properties!.query as { maxLength?: number };
  assert.equal(query.maxLength, 1000);
});

test("install steps start with set -e and join into the script", () => {
  const plan = installScript({ repo: "a/b", path: "x", commit_sha: "a".repeat(40), skill_md_sha: "c".repeat(40) }, "x", "codex", "user");
  assert.equal(plan.steps[0], "set -e");
  assert.equal(plan.script, plan.steps.join("\n"));
});

test("search stopgaps: format synonyms, filler words, whole-word partial matches and rare-word typos", () => {
  const library = OmgskillsLibrary.fromData({ skills: [
    skill("anthropics/skills:pptx", 180000, "Create and edit PowerPoint presentations from a document."),
    skill("x/y:latex-document", 40, "Make a LaTeX document from notes."),
    skill("ops/a:writing-tests", 900, "Write focused unit tests."),
    skill("ops/b:writing-docs", 50, "Writing guides."),
    skill("ops/c:writing-plans", 50, "Writing plans."),
    skill("one/off:writting-helper", 1, "A helper."),
  ], trending: [], goldBasket: [] }, "v1");
  assert.equal(library.searchSkills({ query: "make slides from a document" })[0].id, "anthropics/skills:pptx");
  assert.deepEqual(library.searchWithNote({ query: "writting tests" }).note, { did_you_mean: "writing tests" });
  // "ument" is inside "document", but partial matches need the start of a word.
  assert.deepEqual(library.searchWithNote({ query: "ument qqzzx" }).skills, []);
});

test("copies and mirrors stay out of lists but remain readable by ID", () => {
  const mirror = { ...skill("store/marketplace:skills/anthropics/pdf", 9, "Read PDFs.", { author_handle: "anthropics" }), provenance_type: "repackaged" } as Skill;
  const library = OmgskillsLibrary.fromData({ skills: [
    skill("anthropics/skills:pdf", 100, "Read PDFs."),
    { ...skill("TwoStraws/SwiftUI-Agent-Skill:swiftui-pro/skills/swiftui-pro", 4467, "Write SwiftUI."), name: "swiftui-pro" },
    { ...skill("twostraws/swiftui-agent-skill:swiftui-pro", 6210, "Write SwiftUI.", pinned), name: "swiftui-pro" },
    mirror,
  ], trending: [], goldBasket: [] }, "v1");
  assert.deepEqual(library.searchSkills({ query: "swiftui" }).map(row => row.id), ["twostraws/swiftui-agent-skill:swiftui-pro"]);
  assert.deepEqual(library.listByAuthor("anthropics").map(row => row.id), ["anthropics/skills:pdf"]);
  assert.ok(library.searchSkills({ query: "pdf" }).some(row => row.id === mirror.id), "mirrors stay searchable without an author filter");
  assert.equal(library.getSkill("TwoStraws/SwiftUI-Agent-Skill:swiftui-pro/skills/swiftui-pro")?.stars, 4467);
});
