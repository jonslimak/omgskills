import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchOptions, SkillResult } from "./library.js";
import type { CatalogReader } from "./catalog-reader.js";
import { catalogSorts, defaultLimit, PagingError, type PageInfo, type PageOptions, type SearchNote, type SkillPage } from "./paging.js";
import type { RankedSearchOptions } from "./search-ranking.js";
import { installAgents, installFolderName, installScopes, installScript, installScripts, pinnedInstallFor } from "./install.js";
import { readSkillContent, SkillContentError } from "./content.js";

export const serverVersion = "0.2.2";

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
  install_cmd: z.string().optional().describe("Legacy unpinned example; do not run it. Use get_install_plan instead."),
  author_handle: z.string().optional(),
  tags: z.array(z.string()).optional(),
  stars: z.number().optional(),
  last_updated: z.string().optional(),
  first_seen: z.string().optional(),
  skill_md_sha: z.string().optional(),
  skill_md_path: z.string().optional(),
  install_status: z.enum(["pinned", "discovery_only"]).optional()
    .describe("pinned: get_install_plan can install it at a verified commit. discovery_only: it cannot be installed reproducibly. Omitted only when the catalog does not record it."),
  pinned_install: pinnedInstallSchema.optional(),
  install: z.object({ claude_code: z.string(), codex: z.string() }).optional()
    .describe("get_skill only: user-scope install scripts pinned to commit_sha, for pinned skills."),
  score: z.number().optional().describe("Relevance to this query; only meaningful within one result list."),
  installs: z.number().optional(),
  trending_rank: z.number().optional(),
  gold_score: z.number().optional(),
  niche: z.string().optional(),
  niche_label: z.string().optional()
});

const searchNoteSchema = z.object({
  did_you_mean: z.string().optional(),
  partial_match: z.boolean().optional(),
  showing_trending: z.boolean().optional()
});
const pageSchema = z.object({ total: z.number().int().nonnegative(), hasMore: z.boolean(), nextCursor: z.string().nullable(),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/), sort: z.enum(catalogSorts) });
const skillListOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  skills: z.array(skillResultSchema),
  page: pageSchema.optional(),
  search: searchNoteSchema.optional(),
  missing: z.array(z.string()).optional(),
  found: z.boolean().optional().describe("related_skills: false when the given ID is not in the catalog.")
});

const limitArg = (max = 100) => z.number().int().min(1).max(max).default(defaultLimit).describe("Maximum number of skills to return.");
const summaryArg = z.boolean().default(true)
  .describe("Default true: list fields and install_status, without install metadata. Pass false for pinned_install, or call get_skill.");
const installableArg = z.boolean().optional().describe("true: only skills that get_install_plan can install (pinned to a verified commit).");
const pageArg = z.object({ cursor: z.string().optional() }).strict().optional()
  .describe("Paging: omit or {} for the first page, then {cursor: page.nextCursor} with otherwise unchanged arguments.");
const sortArg = z.enum(catalogSorts).optional().describe("Sort matching skills. Defaults to relevance.");

const tooLongQuery = "query is too long (over 1,000 characters or 1,024 bytes); use a few keywords or a short task description";
const searchInput = z.object({
  // The byte limit matches the paging validator, so long CJK or emoji queries fail here with a
  // normal input error instead of a paging error.
  // The byte check skips queries already over 1,000 characters so the error is reported once.
  query: z.string().max(1000, tooLongQuery).refine(query => query.length > 1000 || Buffer.byteLength(query) <= 1024, tooLongQuery).default("")
    .describe("Keywords or a short task description. Typos are corrected; an empty query lists trending skills."),
  limit: limitArg(),
  author: z.string().optional().describe("GitHub author handle, case-insensitive, with or without @."),
  tag: z.string().optional().describe("Exact catalog tag, matched case-insensitively."),
  minStars: z.number().int().min(0).optional().describe("Minimum GitHub repository star count."),
  installable: installableArg,
  summary: summaryArg
});
const authorInput = z.object({
  author: z.string().min(1).describe("GitHub author handle, case-insensitive, with or without @."),
  limit: limitArg(),
  summary: summaryArg
});
const trendingInput = z.object({ limit: limitArg(), summary: summaryArg });
const goldInput = z.object({ limit: limitArg(), summary: summaryArg });
const idArg = z.string().min(1).max(500).describe("Skill ID, such as anthropics/skills:pdf. Case-insensitive; a catalog: prefix is accepted.");

type ServerOptions = { paging?: boolean; ranking?: boolean; fetcher?: typeof fetch };
type PublicSkill = z.infer<typeof skillResultSchema>;

export function createOmgskillsServer(library: CatalogReader, options: ServerOptions = {}): McpServer {
  if (options.ranking && !options.paging) throw new Error("Candidate ranking requires paging");
  const server = new McpServer(
    {
      name: "omgskills",
      version: serverVersion
    },
    {
      maxToolInputElements: 128,
      instructions: [
        "Search and inspect the public omgskills catalog of agent skills for Claude Code and Codex. All tools are read-only.",
        "Use search_skills for discovery (keywords or a short task; pass installable: true for skills you can install), get_skill for one ID, list_by_author for a GitHub handle, and list_trending or list_gold_basket for popular and curated skills.",
        "Before installing, read the skill with get_skill_content, then call get_install_plan and run its script; it fetches the pinned commit and verifies SKILL.md.",
        "If install_status is discovery_only, do not install from github_url or install_cmd: use related_skills to find a pinned alternative, or report that this record cannot be installed reproducibly."
      ].join(" ")
    }
  );

  const searchSchema = options.ranking
    ? searchInput.extend({ sort: sortArg, page: pageArg, ranking: z.literal("web-v1").optional().describe("Optional alternative ranking used by the omgskills web app.") })
    : options.paging ? searchInput.extend({ sort: sortArg, page: pageArg }) : searchInput;
  server.registerTool(
    "search_skills",
    {
      title: "Search skills",
      description: "Search the omgskills catalog by keyword or short task description, with optional filters. Returns compact rows with install_status by default; only pinned records can be installed reproducibly, and installable: true returns only those.",
      inputSchema: searchSchema.strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof searchInput> & Partial<PageOptions> & { ranking?: "web-v1" }) => {
      const reader = readerFor(library, args.summary);
      return listResult(args, options.paging ? reader => {
        if (args.ranking !== undefined) {
          if (!options.ranking || !reader.searchRankedPage) throw new PagingError("ranking_not_supported");
          return reader.searchRankedPage(withPage(args) as RankedSearchOptions);
        }
        if (!reader.searchPage) throw new PagingError("paging_not_supported");
        return reader.searchPage(withPage(args) as SearchOptions & PageOptions);
      } : undefined, async reader => {
        if (reader.searchWithNote) { const found = await reader.searchWithNote(args); return { skills: found.skills, search: found.note }; }
        return { skills: await reader.searchSkills(args) };
      }, reader);
    }
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description: "Get one skill by ID, with install_status, a pinned_install plan and per-agent install scripts when a commit is pinned.",
      inputSchema: z.object({ id: idArg }).strict(),
      outputSchema: z.object({ found: z.boolean(), skill: skillResultSchema.nullable() }),
      annotations: toolAnnotations
    },
    async ({ id }) => {
      const rawSkill = await library.getSkill(id);
      if (!rawSkill) return result({ found: false, skill: null }, await notFoundText(library, id));
      const skill = publicSkill(rawSkill, { withScore: false, withInstall: true });
      return result({ found: true, skill }, skillText(skill));
    }
  );

  server.registerTool(
    "get_skills",
    {
      title: "Get skills",
      description: "Get up to 30 skills by ID in one read. Preserves requested order, removes duplicates, and lists IDs that were not found in missing.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1).max(500)).min(1).max(30).describe("Skill IDs in display order."),
        summary: summaryArg
      }).strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ ids, summary }) => {
      const reader = readerFor(library, summary);
      const requested = [...new Set(ids)];
      const found = await Promise.all(requested.map(id => reader.getSkill(id)));
      const missing = requested.filter((_, index) => !found[index]);
      const skills = [...new Map(found.flatMap(skill => skill ? [[skill.id, skill] as const] : [])).values()];
      return listOutput(skills, summary, { ...(missing.length ? { missing } : {}) });
    }
  );

  server.registerTool(
    "list_trending",
    {
      title: "List trending skills",
      description: "List skills ordered by the current omgskills trending ranking.",
      inputSchema: (options.paging ? trendingInput.extend({ page: pageArg }) : trendingInput).strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof trendingInput> & Partial<PageOptions>) => {
      const reader = readerFor(library, args.summary);
      return listResult(args, options.paging ? reader => {
        if (!reader.listTrendingPage) throw new PagingError("paging_not_supported");
        return reader.listTrendingPage(withPage(args) as PageOptions);
      } : undefined, async reader => ({ skills: await reader.listTrending(args.limit) }), reader);
    }
  );

  server.registerTool(
    "list_gold_basket",
    {
      title: "List curated skills",
      description: "List skills from the curated omgskills gold basket, ordered by editorial score.",
      inputSchema: (options.paging ? goldInput.extend({ page: pageArg }) : goldInput).strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    // Curated rows are complete records, so they never need the summary reader.
    async (args: z.infer<typeof goldInput> & Partial<PageOptions>) => listResult(args, options.paging ? reader => {
      if (!reader.listGoldBasketPage) throw new PagingError("paging_not_supported");
      return reader.listGoldBasketPage(withPage(args) as PageOptions);
    } : undefined, async reader => ({ skills: await reader.listGoldBasket(args.limit) }), library)
  );

  server.registerTool(
    "list_by_author",
    {
      title: "List skills by author",
      description: "List skills published by a GitHub author handle in the omgskills catalog.",
      inputSchema: (options.paging ? authorInput.extend({ sort: sortArg, page: pageArg }) : authorInput).strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async (args: z.infer<typeof authorInput> & Partial<PageOptions>) => {
      const reader = readerFor(library, args.summary);
      return listResult(args, options.paging ? reader => {
        if (!reader.listByAuthorPage) throw new PagingError("paging_not_supported");
        return reader.listByAuthorPage(args.author, withPage(args) as PageOptions);
      } : undefined, async reader => ({ skills: await reader.listByAuthor(args.author, args.limit) }), reader);
    }
  );

  server.registerTool(
    "related_skills",
    {
      title: "Related skills",
      description: "Find other skills for the same job as a given skill: those sharing the most name words first (in their own name ahead of only in the description), then most-starred. Pass installable: true when a skill is discovery_only and you need a pinned alternative.",
      inputSchema: z.object({ id: idArg, limit: limitArg(20).default(5), installable: installableArg, summary: summaryArg }).strict(),
      outputSchema: skillListOutputSchema,
      annotations: toolAnnotations
    },
    async ({ id, limit, installable, summary }) => {
      let related: SkillResult[] | undefined;
      try { related = await library.relatedSkills?.(id, limit, installable); }
      catch (error) { if (error instanceof PagingError) return errorResult(error.code, error.message); throw error; }
      // Not found is a normal result, the same as get_skill, get_install_plan and get_skill_content.
      if (!related) return result({ found: false, count: 0, skills: [] }, await notFoundText(library, id));
      const skills = summary ? related : (await Promise.all(related.map(skill => library.getSkill(skill.id)))).flatMap(skill => skill ? [skill] : []);
      return listOutput(skills, summary);
    }
  );

  server.registerTool(
    "get_install_plan",
    {
      title: "Get install plan",
      description: "Get exact, commit-pinned install steps for a skill and agent: a shell script that fetches the pinned commit, verifies SKILL.md and copies the skill folder into the agent's skills directory. For discovery_only skills, explains why and suggests pinned alternatives.",
      inputSchema: z.object({
        id: idArg,
        agent: z.enum(installAgents).default("claude_code").describe("Which agent the skill is for."),
        scope: z.enum(installScopes).default("user").describe("user: your home skills folder. project: the current repository's skills folder.")
      }).strict(),
      outputSchema: z.object({
        found: z.boolean(),
        installable: z.boolean(),
        id: z.string().optional(),
        agent: z.enum(installAgents),
        scope: z.enum(installScopes),
        destination: z.string().optional(),
        pinned_install: pinnedInstallSchema.optional(),
        steps: z.array(z.string()).optional(),
        script: z.string().optional(),
        reason: z.string().optional(),
        alternatives: z.array(skillResultSchema).optional()
      }),
      annotations: toolAnnotations
    },
    async ({ id, agent, scope }) => {
      const skill = await library.getSkill(id);
      if (!skill) return result({ found: false, installable: false, agent, scope }, await notFoundText(library, id));
      const pin = pinnedInstallFor(skill), name = pin && installFolderName(skill, pin);
      if (pin && name) {
        const plan = installScript(pin, name, agent, scope);
        const value = { found: true, installable: true, id: skill.id, agent, scope, destination: plan.destination, pinned_install: pin, steps: plan.steps, script: plan.script };
        return result(value, `Install ${skill.id} for ${agent} (${scope}) into ${plan.destination}, pinned to ${pin.repo}@${pin.commit_sha.slice(0, 12)}. Run:\n\n${plan.script}`);
      }
      const reason = "No commit is recorded for this skill yet, so its files can't be fetched at a fixed, verified version. Don't install it from the default branch.";
      const alternatives = await pinnedAlternatives(library, skill.id);
      const value = { found: true, installable: false, id: skill.id, agent, scope, reason, ...(alternatives.length ? { alternatives } : {}) };
      return result(value, [reason, alternatives.length ? `Pinned alternatives:\n${alternatives.map(row).join("\n")}` : "No pinned alternative was found."].join("\n\n"));
    }
  );

  server.registerTool(
    "get_skill_content",
    {
      title: "Get skill content",
      description: "Read a skill's SKILL.md from GitHub at its pinned commit (or the default branch for discovery_only skills), and check it against the catalog hash. Read this before installing.",
      inputSchema: z.object({
        id: idArg,
        max_chars: z.number().int().min(500).max(60_000).default(12_000).describe("Return at most this many characters.")
      }).strict(),
      outputSchema: z.object({
        found: z.boolean(),
        id: z.string().optional(),
        path: z.string().optional(),
        ref: z.string().optional(),
        pinned: z.boolean().optional(),
        verified: z.boolean().optional(),
        truncated: z.boolean().optional(),
        content: z.string().optional()
      }),
      annotations: { ...toolAnnotations, openWorldHint: true }
    },
    async ({ id, max_chars }) => {
      const skill = await library.getSkill(id);
      if (!skill) return result({ found: false }, await notFoundText(library, id));
      try {
        const content = await readSkillContent(skill, max_chars, options.fetcher);
        const header = `${content.path} at ${content.pinned ? content.ref.slice(0, 12) : "the default branch (not pinned)"}${content.verified ? ", matches the catalog hash" : ", does NOT match the catalog hash"}${content.truncated ? `, truncated to ${max_chars} characters` : ""}.`;
        return result({ found: true, ...content }, `${header}\n\n${content.content}`);
      } catch (error) {
        return errorResult("content_unavailable", error instanceof SkillContentError ? error.message : "SKILL.md could not be read.");
      }
    }
  );

  return server;
}

function withPage(args: object) { return "page" in args ? args : { ...args, page: {} }; }

type ListRead = { skills: SkillResult[]; page?: PageInfo; search?: SearchNote };
/**
 * Lists page by default where the reader supports it, so every result reports its total and
 * next cursor. A first page that cannot be served (no complete snapshot) falls back to the
 * unpaged read; an explicit page request reports the error instead.
 */
async function listResult(args: { summary?: boolean }, paged: ((reader: CatalogReader) => SkillPage | Promise<SkillPage>) | undefined,
  unpaged: (reader: CatalogReader) => Promise<ListRead>, reader: CatalogReader) {
  const explicit = "page" in args || "ranking" in args;
  if (paged) {
    try {
      const value = await paged(reader);
      return listOutput(value.skills, args.summary, { page: value.page, ...(value.search ? { search: value.search } : {}) });
    } catch (error) {
      const fallback = !explicit && error instanceof PagingError && ["catalog_unavailable", "paging_not_supported"].includes(error.code);
      if (!fallback) {
        const safe = error instanceof PagingError ? error : new PagingError("catalog_unavailable");
        return errorResult(safe.code, safe.message);
      }
    }
  }
  try {
    const value = await unpaged(reader);
    return listOutput(value.skills, args.summary, value.search ? { search: value.search } : {});
  } catch (error) {
    if (error instanceof PagingError) return errorResult(error.code, error.message);
    throw error;
  }
}

function listOutput(skills: SkillResult[], summary = true, extra: { page?: PageInfo; search?: SearchNote; missing?: string[] } = {}) {
  const rows = skills.map(skill => summary ? summarySkill(skill) : publicSkill(skill));
  const value = { count: rows.length, skills: rows, ...extra };
  return result(value, renderList(rows, extra, summary));
}

function readerFor(library: CatalogReader, summary: boolean | undefined): CatalogReader {
  return summary ? library.summaryReader?.() ?? library : library;
}

// List fields only: never derive install_status from a record whose install fields were not loaded.
function summarySkill(skill: SkillResult) {
  const { install_cmd: _cmd, skill_md_sha: _sha, skill_md_path: _path, repo_commit_sha: _commit, skill_tree_sha: _tree, ...rest } = skill;
  return skillResultSchema.parse(rest);
}

function publicSkill(skill: SkillResult, options: { withScore?: boolean; withInstall?: boolean } = {}) {
  const pinnedInstall = pinnedInstallFor(skill);
  const install = options.withInstall && pinnedInstall ? installScripts(skill, pinnedInstall) : undefined;
  const { score, ...rest } = skill;
  return skillResultSchema.parse({
    ...rest,
    ...(options.withScore === false ? {} : { score }),
    install_status: pinnedInstall ? "pinned" : "discovery_only",
    ...(pinnedInstall ? { pinned_install: pinnedInstall } : {}),
    ...(install ? { install } : {})
  });
}

async function pinnedAlternatives(library: CatalogReader, id: string) {
  // Ask for installable matches when the catalog records them; otherwise check the closest few.
  const related = (await (async () => library.relatedSkills?.(id, 3, true))().catch(() => library.relatedSkills?.(id, 8))) ?? [];
  const full = await Promise.all(related.map(skill => library.getSkill(skill.id)));
  // A direct lookup has no query, so these rows carry no score.
  return full.flatMap(skill => {
    if (!skill || !pinnedInstallFor(skill)) return [];
    const { score: _score, ...row } = summarySkill(skill);
    return [row];
  }).slice(0, 3);
}

async function notFoundText(library: CatalogReader, id: string) {
  const reader = readerFor(library, true), clean = id.trim().replace(/^catalog:/i, "");
  const [repo, name = ""] = clean.toLowerCase().split(":");
  // A typo in the skill part: suggest the closest names in the same repository first.
  const sameRepo = name ? (await reader.listByAuthor(repo.split("/")[0], 100))
    .filter(skill => skill.id.toLowerCase().startsWith(`${repo}:`))
    .map(skill => ({ id: skill.id, shared: sharedPrefix(skill.id.toLowerCase().slice(repo.length + 1), name) }))
    .filter(row => row.shared >= Math.min(3, name.length)).sort((a, b) => b.shared - a.shared).map(row => row.id) : [];
  const words = clean.split(/[^a-z0-9]+/i).filter(word => word.length >= 3).slice(-3).join(" ");
  const searched = words ? (await reader.searchSkills({ query: words, limit: 3 })).map(skill => skill.id) : [];
  const suggestions = [...new Set([...sameRepo, ...searched])].slice(0, 3);
  return `No skill with ID ${id}.${suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : " Use search_skills to find one."}`;
}
function sharedPrefix(a: string, b: string) { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; }

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
/** get_skill's readable summary; structuredContent carries every field, including install scripts. */
function skillText(skill: PublicSkill) {
  const pin = skill.pinned_install;
  return [
    row(skill).slice(2),
    skill.github_url ? `Source: ${skill.github_url}${skill.skill_md_path ? ` (${skill.skill_md_path})` : ""}` : "",
    pin ? `Pinned to ${pin.repo}@${pin.commit_sha.slice(0, 12)}. Read it with get_skill_content; install with get_install_plan (claude_code or codex).`
      : "discovery_only: no pinned commit, so don't install it from github_url. Use related_skills to find a pinned alternative.",
  ].filter(Boolean).join("\n");
}

function row(skill: PublicSkill) {
  const description = (skill.description ?? "").replace(/\s+/g, " ").trim();
  const short = description.length > 160 ? `${description.slice(0, 157).trimEnd()}...` : description;
  const facts = [skill.stars !== undefined ? `${compactNumber.format(skill.stars)} stars` : "", skill.install_status ?? ""].filter(Boolean).join(", ");
  return `- ${skill.id}${skill.name && !skill.id.endsWith(skill.name) ? ` (${skill.name})` : ""}${facts ? ` [${facts}]` : ""}${short ? `: ${short}` : ""}`;
}

/** One line per skill: the readable form of the result. structuredContent carries every field. */
function renderList(rows: PublicSkill[], extra: { page?: PageInfo; search?: SearchNote; missing?: string[] }, summary: boolean) {
  const lines: string[] = [];
  if (extra.search?.did_you_mean) lines.push(`No exact match; showing results for "${extra.search.did_you_mean}".`);
  if (extra.search?.partial_match) lines.push("No skill matched every word; showing skills that match some of them.");
  if (extra.search?.showing_trending) lines.push("Empty query; showing trending skills.");
  lines.push(rows.length ? `${rows.length} skill${rows.length === 1 ? "" : "s"}${extra.page ? ` of ${extra.page.total}` : ""}:` : "No skills found. Try fewer or broader words, or list_trending.");
  lines.push(...rows.map(row));
  if (extra.missing?.length) lines.push(`Not found: ${extra.missing.join(", ")}`);
  if (extra.page?.hasMore) lines.push(`More results: repeat the call with page: {"cursor": "${extra.page.nextCursor}"}.`);
  if (summary && rows.length) lines.push("For install details call get_skill or get_install_plan with an id.");
  return lines.join("\n");
}

function errorResult(code: string, message: string) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }] };
}

function result(structuredContent: Record<string, unknown>, text: string) {
  return { structuredContent, content: [{ type: "text" as const, text }] };
}
