#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OmgskillsLibrary } from "./library.js";

const library = await OmgskillsLibrary.load();

const server = new McpServer({
  name: "omgskills",
  version: "0.1.0"
});

server.tool(
  "search_skills",
  "Search the omgskills library by keyword, author, tag, and minimum star count.",
  {
    query: z.string().default(""),
    limit: z.number().int().min(1).max(100).default(20),
    author: z.string().optional(),
    tag: z.string().optional(),
    minStars: z.number().int().min(0).optional()
  },
  async ({ query, limit, author, tag, minStars }) => jsonResult(library.searchSkills({ query, limit, author, tag, minStars }))
);

server.tool(
  "get_skill",
  "Get one full skill record by stable skill id.",
  {
    id: z.string().min(1)
  },
  async ({ id }) => {
    const skill = library.getSkill(id);
    if (!skill) {
      return jsonResult({ error: "Skill not found", id });
    }
    return jsonResult(skill);
  }
);

server.tool(
  "list_trending",
  "List skills ranked by trending metadata.",
  {
    limit: z.number().int().min(1).max(100).default(20)
  },
  async ({ limit }) => jsonResult(library.listTrending(limit))
);

server.tool(
  "list_gold_basket",
  "List curated gold-basket skills ranked by score.",
  {
    limit: z.number().int().min(1).max(100).default(20)
  },
  async ({ limit }) => jsonResult(library.listGoldBasket(limit))
);

server.tool(
  "list_by_author",
  "List skills for a GitHub author handle.",
  {
    author: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(20)
  },
  async ({ author, limit }) => jsonResult(library.listByAuthor(author, limit))
);

await server.connect(new StdioServerTransport());

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}
