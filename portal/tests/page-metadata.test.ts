import test from "node:test";
import assert from "node:assert/strict";
import { initialNavigation } from "../src/app/unified/model";
import { createPageMetadata, pageTitle } from "../src/app/unified/page-metadata";

const catalog = {
  skills: [{ id: "anthropics/skills:skills/pdf", name: "pdf" }],
  creators: [{ handle: "anthropics", name: "Anthropic" }],
  collections: [{ id: "starter-pack", name: "Starter Skills" }],
} as never;
const nav = (value: object) => ({ ...initialNavigation, view: "discover" as const, ...value });

test("tab titles follow the view", () => {
  assert.equal(pageTitle(nav({}), catalog), "Discover | omgskills");
  assert.equal(pageTitle(nav({ view: "creator", id: "anthropics" }), catalog), "Anthropic | omgskills");
  assert.equal(pageTitle(nav({ view: "creator", id: "anthropics", selected: "catalog:anthropics/skills:skills/pdf" }), catalog), "pdf | omgskills");
  assert.equal(pageTitle(nav({ view: "collection", id: "starter-pack" }), catalog), "Starter Skills | omgskills");
  assert.equal(pageTitle(nav({ view: "creators", id: "companies" }), catalog), "Companies | omgskills");
  assert.equal(pageTitle(nav({ query: "pdf" }), catalog), "“pdf” | omgskills");
  assert.equal(pageTitle(nav({ view: "top" }), catalog), "Trending skills | omgskills");
});

function fakePage(path: string) {
  const head: { children: Element[] } = { children: [] };
  const element = (tag: string, attrs: Record<string, string> = {}) => {
    const el = { tag, ...attrs, get isConnected() { return head.children.includes(el as never); },
      remove() { head.children = head.children.filter(child => child !== (el as never)); } };
    return el as never as Element;
  };
  const canonical = element("link", { rel: "canonical" });
  const description = element("meta", { name: "description" });
  head.children.push(canonical, description);
  const doc = { title: "Anthropic's skills | omgskills", location: { pathname: path, search: "" },
    head: { querySelectorAll: () => [canonical, description], append: (el: Element) => head.children.push(el) },
    createElement: (tag: string) => element(tag) };
  return { doc: doc as never as Document, head, canonical, description };
}

test("a taken-over page keeps its own tags on its own view, and swaps them for noindex elsewhere", () => {
  const { doc, head, canonical, description } = fakePage("/library/anthropics/");
  const sync = createPageMetadata(doc, true);
  sync("/library/anthropics/", "Anthropic | omgskills");
  assert.equal(doc.title, "Anthropic's skills | omgskills", "the static page's own title stays");
  assert.ok(canonical.isConnected && description.isConnected);
  sync("/app/library/trending/", "Trending skills | omgskills");
  assert.equal(doc.title, "Trending skills | omgskills");
  assert.equal(canonical.isConnected, false);
  assert.equal(description.isConnected, false);
  const robots = head.children.find(el => (el as never as { name?: string }).name === "robots") as never as { content: string };
  assert.equal(robots.content, "noindex, follow");
  sync("/library/anthropics/", "Anthropic | omgskills");
  assert.ok(canonical.isConnected && description.isConnected, "Back restores the page's tags");
  assert.equal(head.children.some(el => (el as never as { name?: string }).name === "robots"), false);
});

test("ordinary /app pages only update the title", () => {
  const { doc, canonical } = fakePage("/app/library/anthropics/");
  const sync = createPageMetadata(doc, false);
  sync("/app/library/trending/", "Trending skills | omgskills");
  assert.equal(doc.title, "Trending skills | omgskills");
  assert.ok(canonical.isConnected);
});
