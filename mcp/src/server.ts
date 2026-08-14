import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OmgskillsLibrary, type SkillResult } from "./library.js";

const toolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false
} as const;

const skillResultSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  github_url: z.string().optional(),
  install_cmd: z.string().optional(),
  author_handle: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stars: z.number().optional(),
  last_updated: z.string().optional(),
  first_seen: z.string().optional(),
  skill_md_sha: z.string().optional(),
  skill_md_path: z.string().optional(),
  score: z.number(),
  installs: z.number().optional(),
  trending_rank: z.number().optional(),
  gold_score: z.number().optional(),
  niche: z.string().optional(),
  niche_label: z.string().optional()
});

const skillListOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  skills: z.array(skillResultSchema)
});

const skillOutputSchema = z.object({
  found: z.boolean(),
  skill: skillResultSchema.nullable()
});

export function createOmgskillsServer(library: OmgskillsLibrary): McpServer {
  const server = new McpServer(
    {
      name: "omgskills",
      version: "0.1.0"
    },
    {
      instructions:
        "Search and inspect the public omgskills catalog. All tools are read-only. Use search_skills for discovery, get_skill for an exact stable ID, list_by_author for a known GitHub handle, and the ranked list tools for trending or curated skills."
    }
  );

  server.registerTool(
    "search_skills",
    {
      title: "Search skills",
      description: "Search the omgskills catalog by keyword with optional author, tag, and minimum-star filters.",
      inputSchema: {
        query: z.string().default("").describe("Keywords to match against skill names, IDs, authors, tags, descriptions, and repository URLs."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return."),
        author: z.string().optional().describe("Exact GitHub author handle, matched case-insensitively."),
        tag: z.string().optional().describe("Exact catalog tag, matched case-insensitively."),
        minStars: z.number().int().min(0).optional().describe("Minimum GitHub repository star count.")
      },
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ query, limit, author, tag, minStars }) =>
      skillListResult(library.searchSkills({ query, limit, author, tag, minStars }))
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description: "Get one skill from the omgskills catalog by its exact stable catalog ID.",
      inputSchema: {
        id: z.string().min(1).describe("Stable skill ID, such as anthropics/skills:algorithmic-art.")
      },
      outputSchema: skillOutputSchema,
      annotations: toolAnnotations
    },
    async ({ id }) => {
      const skill = library.getSkill(id) ?? null;
      const structuredContent = { found: skill !== null, skill };
      return result(structuredContent, skill ?? { error: "Skill not found", id });
    }
  );

  server.registerTool(
    "list_trending",
    {
      title: "List trending skills",
      description: "List skills ordered by the current omgskills trending ranking.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return.")
      },
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ limit }) => skillListResult(library.listTrending(limit))
  );

  server.registerTool(
    "list_gold_basket",
    {
      title: "List curated skills",
      description: "List skills from the curated omgskills gold basket, ordered by editorial score.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return.")
      },
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ limit }) => skillListResult(library.listGoldBasket(limit))
  );

  server.registerTool(
    "list_by_author",
    {
      title: "List skills by author",
      description: "List skills published by an exact GitHub author handle in the omgskills catalog.",
      inputSchema: {
        author: z.string().min(1).describe("GitHub author handle, matched case-insensitively."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return.")
      },
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ author, limit }) => skillListResult(library.listByAuthor(author, limit))
  );

  return server;
}

function skillListResult(skills: SkillResult[]) {
  return result({ count: skills.length, skills }, skills);
}

function result(structuredContent: Record<string, unknown>, textData: unknown) {
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(textData, null, 2)
      }
    ]
  };
}
