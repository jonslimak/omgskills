import type { CatalogDisplay } from "../src/app/unified/model";

// Synthetic public API for the guarded localhost presentation fixture only.
export function publicPagingFixture(catalog: CatalogDisplay, mode: string | null) {
  const skills = Array.from({ length: 65 }, (_, i) => ({
    id: `anthropics/review-fixture:design-${String(i + 1).padStart(2, "0")}`, name: `design-${String(i + 1).padStart(2, "0")}`,
    description: "Design an accessible interface with clear interaction and layout.", author_handle: "anthropics",
    github_url: "https://github.com/anthropics/skills", tags: ["design"], stars: 6500 - i * 100,
  }));
  let failed = false, generation = "a";
  return async (path: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    if (path.endsWith("manifest.json")) {
      if (mode === "metadata") await new Promise(resolve => setTimeout(resolve, 1500));
      return Response.json({ collections: { path: "collections-abcdef.json" } });
    }
    if (path.includes("collections-")) return Response.json({ collections: [
      ...catalog.creators.map(creator => ({ id: creator.handle, title: creator.name, type: "author", authorHandle: creator.handle, subtitle: creator.tagline })),
      ...catalog.collections.map(collection => ({ id: collection.id, title: collection.name, subtitle: collection.description, type: "topic", skillIds: collection.skillIds })),
    ] });
    if (path === "/catalog-skill-urls.json") return Response.json({ skills: {} });
    if (path !== "/mcp") throw new Error("Unexpected local fixture request");
    const call = JSON.parse(String(init?.body));
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: call.id, result });
    if (call.method === "tools/list") return reply({ tools: ["search_skills", "list_by_author", "list_trending"].map(name => ({ name,
      inputSchema: { type: "object", properties: { page: { type: "object" }, ...(name === "search_skills" ? { ranking: { type: "string", const: "web-v1" } } : {}) } },
    })) });
    const { name, arguments: args } = call.params;
    if (name === "get_skill") return reply({ structuredContent: { found: true, skill: skills.find(skill => skill.id === args.id) } });
    if (name === "get_skills") return reply({ structuredContent: { skills: skills.filter(skill => args.ids.includes(skill.id)) } });
    const offset = args.page?.cursor ? Number(args.page.cursor.slice(1)) : 0;
    if (offset && !failed && ["append", "snapshot"].includes(mode ?? "")) {
      failed = true;
      if (mode === "append") return new Response("unavailable", { status: 503 });
      generation = "b";
      return reply({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "catalog_snapshot_changed" } }) }] });
    }
    const query = String(args.query ?? "");
    let found = query.includes("no-results") ? [] : [...skills];
    if (args.sort === "name") found.reverse();
    const selected = found.slice(offset, offset + (args.limit ?? 30));
    return reply({ structuredContent: { count: selected.length, skills: selected, ...(args.page ? { page: {
      total: found.length, hasMore: offset + selected.length < found.length,
      nextCursor: offset + selected.length < found.length ? `c${offset + selected.length}` : null,
      snapshot: generation.repeat(64), sort: name === "list_trending" ? "trending" : args.sort ?? "relevance",
    } } : {}) } });
  };
}
