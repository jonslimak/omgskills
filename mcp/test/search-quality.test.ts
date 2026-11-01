import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type Skill } from "../src/library.js";
import { createOmgskillsServer } from "../src/server.js";

const skill = (id: string, stars: number, description: string): Skill => ({ id, name: id.split(":")[1].split("/").pop()!, description,
  github_url: `https://github.com/${id.split(":")[0]}`, install_cmd: "", author_handle: id.split("/")[0], stars });
const library = () => OmgskillsLibrary.fromData({ skills: [
  skill("a/x:swiftui-pro", 50, "Write better SwiftUI views."),
  skill("b/y:swiftui-layout", 40, "Layout helpers for SwiftUI apps."),
  skill("m/n:swiftui-charts", 35, "Charts in SwiftUI."),
  skill("c/z:expo-swift-ui", 30, "Use Swift UI components from Expo."),
  skill("d/w:swift-concurrency", 20, "Swift async and actors for UI code."),
  skill("e/v:swiftlint", 10, "Lint Swift code."),
  skill("f/u:pptx", 900, "Create and edit presentations and slide decks."),
  skill("g/t:document-processing", 99000, "Convert documents, including PPTX and PDF."),
  skill("h/s:slides-from-notes", 5, "Turn notes into slides."),
  skill("i/r:slack", 500000, "Use the Slack tool to react, pin and send messages."),
  skill("j/q:react-patterns", 2000, "React hooks and components."),
  skill("k/p:react-testing", 100, "Test React components."),
  skill("l/o:review", 70, "This review rejects nonsense code."),
], trending: [], goldBasket: [] }, "v1");
const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();

test("spacing and hyphens in a query find the same skills", () => {
  const l = library();
  const found = ["swiftui", "swift ui", "swift-ui", "SwiftUI"].map(query => l.searchPage({ query, page: {}, limit: 100 }));
  for (const page of found) assert.deepEqual(ids(page.skills), ids(found[0].skills));
  assert.deepEqual(ids(found[0].skills), ["a/x:swiftui-pro", "b/y:swiftui-layout", "c/z:expo-swift-ui", "m/n:swiftui-charts"]);
});

test("a task naming a file format lists the skills named for it first", () => {
  const top = library().searchPage({ query: "make slides from a document", page: {}, limit: 3 }).skills.map(row => row.id);
  assert.deepEqual(top.slice(0, 2).sort(), ["f/u:pptx", "h/s:slides-from-notes"]);
  assert.equal(top[2], "g/t:document-processing");
});

test("nonsense returns nothing instead of one stray description match", () => {
  const page = library().searchPage({ query: "zzqxv nonsense", page: {} });
  assert.equal(page.page.total, 0);
  assert.equal(page.search, undefined);
});

test("sorting by stars keeps to skills named for the query when there are any", () => {
  const l = library();
  assert.deepEqual(l.searchPage({ query: "react", sort: "stars", page: {} }).skills.map(row => row.id), ["j/q:react-patterns", "k/p:react-testing"]);
  assert.ok(l.searchPage({ query: "react", page: {} }).skills.some(row => row.id === "i/r:slack"));
  // With no named skill, every match stays listed.
  assert.deepEqual(l.searchPage({ query: "messages", sort: "stars", page: {} }).skills.map(row => row.id), ["i/r:slack"]);
});

test("stars and date sorts retain compact tag and ID matches but exclude description-only hits", () => {
  const rows = [
    skill("a/x:swiftui-pro", 50, "Write SwiftUI views."),
    skill("b/y:swiftui-layout", 40, "SwiftUI layouts."),
    skill("c/z:swiftui-charts", 30, "SwiftUI charts."),
    { ...skill("d/w:helper", 200, "Tagged tools."), tags: ["swift-ui"] },
    { ...skill("e/v:swift-ui", 100, "Identified tools."), name: "Other helper" },
    skill("f/u:description-only", 500000, "Use Swift UI views."),
  ];
  const l = OmgskillsLibrary.fromData({ skills: rows, trending: [], goldBasket: [] }, "v1");
  const expected = ids(rows.slice(0, 5));
  for (const query of ["swiftui", "swift ui", "swift-ui"]) {
    for (const sort of ["stars", "updated", "added"] as const) {
      const found: Skill[] = [];
      let cursor: string | null = null;
      do {
        const page = l.searchPage({ query, sort, limit: 2, page: cursor ? { cursor } : {} });
        assert.equal(page.page.total, expected.length);
        found.push(...page.skills);
        cursor = page.page.nextCursor;
      } while (cursor);
      assert.deepEqual(ids(found), expected);
    }
  }
});

test("typo-corrected format searches keep the same format boost as the corrected query", () => {
  const l = OmgskillsLibrary.fromData({ skills: [
    skill("a/b:pptx", 900, "Create presentations."),
    skill("c/d:document-processing", 99000, "Create slides from a document."),
  ], trending: [], goldBasket: [] }, "v1");
  const correct = l.searchPage({ query: "make slides from a document", page: {} });
  const typo = l.searchPage({ query: "make slides from a documemt", page: {} });
  assert.equal(typo.search?.did_you_mean, "slides document");
  assert.deepEqual(typo.skills, correct.skills);
  assert.equal(typo.skills[0].id, "a/b:pptx");
});

test("an unknown ID suggests only close names", async context => {
  const server = createOmgskillsServer(library(), { paging: true });
  const client = new Client({ name: "search-quality", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  const text = async (id: string) => ((await client.callTool({ name: "get_skill", arguments: { id } })).content as { text: string }[])[0].text;
  assert.match(await text("q/q:swiftui-layouts"), /Did you mean: .*b\/y:swiftui-layout/);
  assert.doesNotMatch(await text("q/q:zephyr-react-ui"), /Did you mean/);
});

test("a skill copied into other repositories is listed once, but stays in its author's list and readable by ID", () => {
  const description = "Create distinctive, production-grade frontend interfaces with high design quality.";
  const l = OmgskillsLibrary.fromData({ skills: [
    skill("anthropics/skills:skills/frontend-design", 180000, description),
    skill("anthropics/plugins:frontend-design", 45000, description),
    skill("someone/kit:frontend-design", 900, description),
    skill("other/kit:frontend-design", 800, "My own take on frontend design for dashboards and admin tools."),
    skill("tiny/x:frontend-design", 5, "Frontend design."),
    skill("tiny/y:frontend-design", 4, "Frontend design."),
  ], trending: [], goldBasket: [] }, "v1");
  assert.deepEqual(ids(l.searchPage({ query: "frontend design", page: {} }).skills),
    ["anthropics/skills:skills/frontend-design", "other/kit:frontend-design", "tiny/x:frontend-design", "tiny/y:frontend-design"]);
  assert.deepEqual(ids(l.listByAuthorPage("someone", { page: {} }).skills), ["someone/kit:frontend-design"]);
  assert.equal(l.getSkill("someone/kit:frontend-design")?.id, "someone/kit:frontend-design");
  // The short form of a path ID resolves when it is unambiguous.
  assert.equal(l.getSkill("Anthropics/Skills:frontend-design")?.id, "anthropics/skills:skills/frontend-design");
});

test("a short ID shared by two path IDs resolves to neither", () => {
  const l = OmgskillsLibrary.fromData({ skills: [
    skill("a/b:skills/one/helper", 1, "First helper skill."), skill("a/b:skills/two/helper", 1, "Second helper skill."),
  ], trending: [], goldBasket: [] }, "v1");
  assert.equal(l.getSkill("a/b:helper"), undefined);
});
