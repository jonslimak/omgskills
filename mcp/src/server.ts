import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchOptions, SkillResult } from "./library.js";
import type { CatalogReader } from "./catalog-reader.js";
import { catalogSorts, PagingError, type PageOptions, type SkillPage } from "./paging.js";
import type { RankedSearchOptions } from "./search-ranking.js";

const toolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false
} as const;

const pinnedInstallSchema = z.object({
  repo: z.string(),
  path: z.string(),
  commit_sha: z.string(),
  skill_md_sha: z.string(),
  skill_tree_sha: z.string().optional()
});

const skillResultSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  github_url: z.string().optional(),
  install_cmd: z.string().optional().describe("Legacy unpinned example; do not run it for a pinned install."),
  author_handle: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stars: z.number().optional(),
  last_updated: z.string().optional(),
  first_seen: z.string().optional(),
  skill_md_sha: z.string().optional(),
  skill_md_path: z.string().optional(),
  install_status: z.enum(["pinned", "discovery_only"]).optional().describe("Always present unless summary is true."),
  pinned_install: pinnedInstallSchema.optional(),
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
const pageSchema = z.object({ total: z.number().int().nonnegative(), hasMore: z.boolean(), nextCursor: z.string().nullable(),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/), sort: z.enum(catalogSorts) });
const pagedListOutputSchema = skillListOutputSchema.extend({ page: pageSchema.optional() });
function withPaging<T extends z.AnyZodObject>(schema: T, sorting: boolean) {
  // Retain legacy unknown-key behavior, but reject unknown keys in paged callbacks.
  return schema.extend({ page: z.object({ cursor: z.string().optional() }).strict().optional()
    .describe("Opt into snapshot-bound paging: {} first, then {cursor: previous page.nextCursor} with unchanged arguments."),
    ...(sorting ? { sort: z.enum(catalogSorts).optional().describe("Sort matching skills. Requires page; defaults to existing relevance order.") } : {}) }).passthrough();
}
// Summary reads skip per-result detail loading; results omit install metadata (use get_skill for it).
const summaryArg = z.boolean().optional().describe("Return list fields only, without install metadata. Faster for browsing; call get_skill for install details.");
const searchInput = z.object({
  query: z.string().default("").describe("Keywords to match against skill names, IDs, authors, tags, descriptions, and repository URLs."),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return."),
  author: z.string().optional().describe("Exact GitHub author handle, matched case-insensitively."),
  tag: z.string().optional().describe("Exact catalog tag, matched case-insensitively."),
  minStars: z.number().int().min(0).optional().describe("Minimum GitHub repository star count."),
  summary: summaryArg
});
const authorInput = z.object({
  author: z.string().min(1).describe("GitHub author handle, matched case-insensitively."),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return."),
  summary: summaryArg
});
const trendingInput = z.object({ limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of skills to return."), summary: summaryArg });

const skillOutputSchema = z.object({
  found: z.boolean(),
  skill: skillResultSchema.nullable()
});

export function createOmgskillsServer(library: CatalogReader, options: { paging?: boolean; ranking?: boolean } = {}): McpServer {
  if (options.ranking && !options.paging) throw new Error("Candidate ranking requires paging");
  const server = new McpServer(
    {
      name: "omgskills",
      version: "0.1.1"
    },
    {
      instructions: [
        "Search and inspect the public omgskills catalog. All tools are read-only.",
        "Use search_skills for discovery, get_skill for an exact stable ID, list_by_author for a known GitHub handle, and the ranked list tools for trending or curated skills.",
        "For installation, use only pinned_install.repo, path, and commit_sha; verify SKILL.md against pinned_install.skill_md_sha.",
        "If install_status is discovery_only, do not install from github_url or install_cmd: select a pinned alternative or report that this record cannot be installed reproducibly."
      ].join(" ")
    }
  );

  server.registerTool(
    "search_skills",
    {
      title: "Search skills",
      description: "Search the omgskills catalog by keyword with optional filters. Only records with pinned_install can be installed reproducibly; discovery_only records must not be installed from a mutable branch.",
      inputSchema: options.paging ? (options.ranking ? withPaging(searchInput, true).extend({ ranking: z.literal("web-v1").optional()
        .describe("Opt into Mac-informed keyword ranking and @author queries. Requires page; omitted keeps legacy matching.") }) : withPaging(searchInput, true)) : searchInput,
      outputSchema: options.paging ? pagedListOutputSchema : skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof searchInput> & Partial<PageOptions> & { ranking?: "web-v1" }) => {
      const reader = readerFor(library, args.summary);
      return options.paging && (usesPaging(args) || (options.ranking && "ranking" in args))
      ? pagedResult(args, ["query", "limit", "author", "tag", "minStars", "sort", "page", "summary", ...(options.ranking ? ["ranking"] : [])], () => {
        if (args.ranking !== undefined) {
          if (!options.ranking || !reader.searchRankedPage) throw new PagingError("ranking_not_supported");
          return reader.searchRankedPage(args as RankedSearchOptions);
        }
        if (!reader.searchPage) throw new PagingError("paging_not_supported");
        return reader.searchPage(args as SearchOptions & PageOptions);
      })
      : skillListResult(await reader.searchSkills(args as SearchOptions), args.summary);
    }
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description: "Get one skill by exact catalog ID, including a pinned_install plan only when a catalog commit and safe skill path are available.",
      inputSchema: {
        id: z.string().min(1).describe("Stable skill ID, such as anthropics/skills:algorithmic-art.")
      },
      outputSchema: skillOutputSchema,
      annotations: toolAnnotations
    },
    async ({ id }) => {
      const rawSkill = await library.getSkill(id);
      const skill = rawSkill ? publicSkill(rawSkill) : null;
      const structuredContent = { found: skill !== null, skill };
      return result(structuredContent, skill ?? { error: "Skill not found", id });
    }
  );

  server.registerTool(
    "get_skills",
    {
      title: "Get skills",
      description: "Get up to 30 skills by exact catalog IDs in one read. Preserves requested order, removes duplicate IDs, and omits missing skills.",
      inputSchema: {
        ids: z.array(z.string().min(1).max(500)).min(1).max(30).describe("Stable catalog IDs in display order."),
        summary: summaryArg
      },
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ ids, summary }) => {
      const reader = readerFor(library, summary);
      return skillListResult((await Promise.all([...new Set(ids)].map(id => reader.getSkill(id)))).flatMap(skill => skill ? [skill] : []), summary);
    }
  );

  server.registerTool(
    "list_trending",
    {
      title: "List trending skills",
      description: "List skills ordered by the current omgskills trending ranking.",
      inputSchema: options.paging ? withPaging(trendingInput, false) : trendingInput,
      outputSchema: options.paging ? pagedListOutputSchema : skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof trendingInput> & Partial<PageOptions>) => {
      const reader = readerFor(library, args.summary);
      return options.paging && usesPaging(args)
      ? pagedResult(args, ["limit", "page", "summary"], () => {
        if (!reader.listTrendingPage) throw new PagingError("paging_not_supported");
        return reader.listTrendingPage(args as PageOptions);
      })
      : skillListResult(await reader.listTrending(args.limit), args.summary);
    }
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
    async ({ limit }) => skillListResult(await library.listGoldBasket(limit))
  );

  server.registerTool(
    "list_by_author",
    {
      title: "List skills by author",
      description: "List skills published by an exact GitHub author handle in the omgskills catalog.",
      inputSchema: options.paging ? withPaging(authorInput, true) : authorInput,
      outputSchema: options.paging ? pagedListOutputSchema : skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof authorInput> & Partial<PageOptions>) => {
      const reader = readerFor(library, args.summary);
      return options.paging && usesPaging(args)
      ? pagedResult(args, ["author", "limit", "sort", "page", "summary"], () => {
        if (!reader.listByAuthorPage) throw new PagingError("paging_not_supported");
        return reader.listByAuthorPage(args.author, args as PageOptions);
      })
      : skillListResult(await reader.listByAuthor(args.author, args.limit), args.summary);
    }
  );

  return server;
}

function usesPaging(args: object) { return "page" in args || "sort" in args; }
async function pagedResult(args: object, keys: string[], read: () => SkillPage | Promise<SkillPage>) {
  try {
    if (!("page" in args) || Object.keys(args).some(key => !keys.includes(key))) throw new PagingError("invalid_cursor");
    const value = await read(), skills = value.skills.map((args as { summary?: boolean }).summary ? summarySkill : publicSkill);
    return result({ count: skills.length, skills, page: value.page }, { count: skills.length, skills, page: value.page });
  } catch (error) {
    const safe = error instanceof PagingError ? error : new PagingError("catalog_unavailable");
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
  }
}

function readerFor(library: CatalogReader, summary: boolean | undefined): CatalogReader {
  return summary ? library.summaryReader?.() ?? library : library;
}

function skillListResult(skills: SkillResult[], summary = false) {
  const publicSkills = skills.map(summary ? summarySkill : publicSkill);
  return result({ count: publicSkills.length, skills: publicSkills }, publicSkills);
}

// List fields only: never derive install_status from a record whose install fields were not loaded.
function summarySkill(skill: SkillResult) {
  const { install_cmd: _cmd, skill_md_sha: _sha, skill_md_path: _path, repo_commit_sha: _commit, skill_tree_sha: _tree, ...rest } = skill;
  return skillResultSchema.parse(rest);
}

function publicSkill(skill: SkillResult) {
  const pinnedInstall = pinnedInstallFor(skill);
  return skillResultSchema.parse({
    ...skill,
    install_status: pinnedInstall ? "pinned" : "discovery_only",
    ...(pinnedInstall ? { pinned_install: pinnedInstall } : {})
  });
}

function pinnedInstallFor(skill: SkillResult) {
  const sha = /^[a-f0-9]{40}$/i;
  if (!skill.github_url || !skill.skill_md_path || !skill.repo_commit_sha || !skill.skill_md_sha) return undefined;
  if (!sha.test(skill.repo_commit_sha) || !sha.test(skill.skill_md_sha)) return undefined;

  let url: URL;
  try {
    url = new URL(skill.github_url);
  } catch {
    return undefined;
  }
  const repoParts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || repoParts.length !== 2 || url.search || url.hash) return undefined;
  if (!repoParts.every((part) => /^[a-z0-9_.-]+$/i.test(part))) return undefined;

  const pathParts = skill.skill_md_path.split("/");
  if (pathParts.length < 2 || pathParts.at(-1) !== "SKILL.md") return undefined;
  if (!pathParts.every((part) => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..")) return undefined;

  return {
    repo: repoParts.join("/"),
    path: pathParts.slice(0, -1).join("/"),
    commit_sha: skill.repo_commit_sha.toLowerCase(),
    skill_md_sha: skill.skill_md_sha.toLowerCase(),
    ...(skill.skill_tree_sha && sha.test(skill.skill_tree_sha)
      ? { skill_tree_sha: skill.skill_tree_sha.toLowerCase() }
      : {})
  };
}

function result(structuredContent: Record<string, unknown>, textData: unknown) {
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        // Compact: clients read structuredContent; this copy is a fallback.
        text: JSON.stringify(textData)
      }
    ]
  };
}
