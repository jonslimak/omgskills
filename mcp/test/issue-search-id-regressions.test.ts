import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";
import { loadCatalogReader } from "../src/search-catalog.js";
import { catalogFixture } from "./search-catalog-fixture.js";

const rows: Skill[] = [
  { id: "twostraws/swiftui-agent-skill:swiftui-pro", name: "swiftui-pro", description: "Build modern SwiftUI apps.", stars: 6210 },
  { id: "TwoStraws/SwiftUI-Agent-Skill:swiftui-pro/skills/swiftui-pro", name: "swiftui-pro", description: "Build modern SwiftUI apps.", stars: 4467 },
  { id: "yusufkaran/skills:swiftui-autotest-skill", name: "swiftui-autotest-skill", description: "Test SwiftUI views.", stars: 23 },
  { id: "affaan-m/ecc:react-performance", name: "react-performance", description: "Make React apps faster with profiling.", stars: 2000 },
  { id: "anthropics/skills:pptx", name: "pptx", description: "Create PowerPoint presentations from a document.", stars: 10000 },
  { id: "mattpocock/skills:testing", name: "testing", description: "Write TypeScript tests.", stars: 500 }
].map(row => ({ ...row, github_url: `https://github.com/${row.id.split(":")[0]}`, author_handle: row.id.split("/")[0], install_cmd: "legacy",
  skill_md_path: `skills/${row.name}/SKILL.md`, repo_commit_sha: "a".repeat(40), skill_md_sha: "b".repeat(40) }));

for (const compact of [false, true]) {
  test(`#200–#201 public protocol regressions through ${compact ? "compact" : "full"} catalog reader`, async context => {
    const f = catalogFixture(context, rows, false, { trending: [{ id: rows[0].id, trending_rank: 1 }] });
    const reader = compact ? await loadCatalogReader(f.url, f.options) : OmgskillsLibrary.fromData({ skills: rows,
      trending: [{ id: rows[0].id, trending_rank: 1 }], goldBasket: [] });
    const server = createOmgskillsServer(reader, { paging: true });
    const client = new Client({ name: "issue-regressions", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
    context.after(async () => { await client.close(); await server.close(); });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return { value: response.structuredContent as any, text: (response.content as { text: string }[])[0].text };
    };
    const search = async (query: string, extra: Record<string, unknown> = {}) => (await call("search_skills", { query, ...extra })).value;
    const ids = (result: any) => result.skills.map((row: any) => row.id);
    const exact = await search("swiftui");
    assert.equal(exact.skills[0].id, rows[0].id, "popular exact match wins over low-star helper");
    assert.deepEqual(ids(await search("swift ui")), ids(exact));
    assert.equal(ids(exact).filter((id: string) => id.toLowerCase().includes("twostraws")).length, 1);
    const typo = await search("reactt perfomance");
    assert.equal(typo.search.did_you_mean, "react performance");
    assert.equal(typo.skills[0].id, rows[3].id);
    assert.equal((await search("help me make my app faster")).skills[0].id, rows[3].id);
    assert.equal((await search("make slides from a document")).skills[0].id, rows[4].id);
    for (const args of [{}, { query: "" }]) {
      const empty = (await call("search_skills", args)).value;
      assert.ok(empty.skills.length);
      assert.equal(empty.search.showing_trending, true);
    }
    const missing = await call("search_skills", { query: "zzzzqqqq" });
    assert.deepEqual(missing.value.skills, []);
    assert.match(missing.text, /Try fewer or broader words/);
    const author = await call("list_by_author", { author: "@MattPocock" });
    assert.deepEqual(ids(author.value), [rows[5].id]);
    for (const id of ["Anthropics/Skills:PPTX", "catalog:anthropics/skills:pptx", " CATALOG:ANTHROPICS/skills:PPTX "]) {
      const detail = (await call("get_skill", { id })).value;
      assert.equal(detail.found, true);
      assert.equal(detail.skill.id, rows[4].id);
      assert.equal("score" in detail.skill, false, "lookup is not a query-relative score");
      assert.equal(detail.skill.stars, rows[4].stars);
      assert.equal(detail.skill.skill_md_path, rows[4].skill_md_path, "normalization never rewrites GitHub paths");
    }
    const batch = (await call("get_skills", { ids: [rows[4].id, "catalog:ANTHROPICS/skills:PPTX", "missing/repo:no-skill"] })).value;
    assert.deepEqual(ids(batch), [rows[4].id]);
    assert.deepEqual(batch.missing, ["missing/repo:no-skill"]);
    const duplicate = (await call("get_skill", { id: rows[1].id })).value;
    assert.equal(duplicate.skill.id, rows[1].id, "suppressed list copies remain directly readable");
    const filtered = await search("swiftui", { author: "@TwoStraws", minStars: 1000, installable: true });
    assert.deepEqual(ids(filtered), [rows[0].id]);
  });
}
