import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEditoolPreview,
  createEditoolPreviewServer,
  defaultEditoolPreviewDir,
} from "./editool-preview.js";
import type { CreatorRegistrySource } from "../scraper/creator-registry.js";
import {
  loadPolicySources,
  replacePolicySource,
  typedPolicySources,
} from "../scraper/policy/loader.js";
import {
  blockingPolicyIssues,
  validatePolicy,
} from "../scraper/policy/validator.js";
import type {
  CollectionsPolicySource,
  DoNotCrawlPolicySource,
  PolicySources,
  SuppressedSkillsPolicySource,
} from "../scraper/policy/types.js";
import {
  LEGACY_BLOCKED_OWNERS,
  LEGACY_BLOCKED_REPOS,
} from "../scraper/v2-policy.js";

// Local-only editorial tool server. Serves editool.html and read/save endpoints
// over the curation source files. Never commits, never publishes, never touches
// the network. See arch.md at the repo root.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");

const PORT = Number(process.env.EDITOOL_PORT ?? 4980);
const PREVIEW_PORT = Number(process.env.EDITOOL_PREVIEW_PORT ?? 8787);
const HOST = "127.0.0.1";
const saveToken = randomBytes(24).toString("base64url");
const previewDir = defaultEditoolPreviewDir();
let previewBuildInProgress = false;
let previewServerError: string | null = null;

const paths = {
  html: join(scriptDir, "editool.html"),
  skills: join(indexRoot, "skills.json"),
  goldBasket: join(indexRoot, "gold-basket.json"),
  authorLeaderboards: join(indexRoot, "author-leaderboards.json"),
  proposedCreators: join(indexRoot, "proposed-creators.json"),
  collections: join(indexRoot, "curations", "collections.json"),
  creators: join(indexRoot, "seeds", "creators.json"),
  suppressedSkills: join(indexRoot, "seeds", "suppressed-skills.json"),
  doNotCrawl: join(indexRoot, "seeds", "do-not-crawl.json"),
  cutoverSkills: join(indexRoot, "shadow", "skills.cutover.shadow.json"),
  skillOverlay: join(indexRoot, "shadow", "skills.overlay.json"),
};

// The only files POST /api/save/* may write.
const editablePaths = [paths.collections, paths.creators, paths.suppressedSkills, paths.doNotCrawl];

type Skill = {
  id: string;
  name: string;
  description: string;
  github_url: string;
  author_handle: string;
  tags?: string[];
  stars?: number;
  last_updated?: string;
  provenance_type?: string;
  publisher_repo?: string;
  skill_md_sha?: string;
};

type ProposedCreatorsReport = {
  generatedAt: string;
  candidateCount: number;
  candidates: {
    handle: string;
    suggestedAction: string;
    score: number;
    reasons: string[];
    skillCount: number;
    goldBasketCount: number;
    totalStars: number;
    totalInstalls: number;
    sampleSkillIds: string[];
  }[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptionalJson<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

function atomicWrite(path: string, content: string): void {
  if (!editablePaths.includes(path)) {
    throw new Error(`refusing to write non-editable path: ${path}`);
  }
  const tmp = `${path}.editool-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function atomicWriteJson(path: string, value: unknown): void {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

// creators.json keeps its one-entry-per-line style so tool saves don't churn
// formatting on a committed file. Keys in fixed order, JSON-safe per value.
function formatCreators(source: CreatorRegistrySource): string {
  const lines = source.creators.map((entry) => {
    const parts = [`"handle": ${JSON.stringify(entry.handle)}`];
    if (entry.roles !== undefined) parts.push(`"roles": ${JSON.stringify(entry.roles)}`);
    parts.push(`"watch": ${JSON.stringify(entry.watch ?? false)}`);
    parts.push(`"featured": ${JSON.stringify(entry.featured ?? false)}`);
    if (entry.aliases?.length) parts.push(`"aliases": ${JSON.stringify(entry.aliases)}`);
    if (entry.notes) parts.push(`"notes": ${JSON.stringify(entry.notes)}`);
    return `    { ${parts.join(", ")} }`;
  });
  return `{\n  "creators": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

// ---------- v2 transitional policy (read-only display) ----------
// Legacy exclusions remain effective until observe reports approve enforcement.
// Root-path invalidity already comes from its maintained policy source.

function readV2Blocklists(): { blockedRepos: string[]; knownInvalidRepos: string[]; blockedOwners: string[] } {
  try {
    const policy = typedPolicySources(loadPolicySources());
    return {
      blockedRepos: [...LEGACY_BLOCKED_REPOS].sort(),
      knownInvalidRepos: policy.rootSkillInvalid.repos.map((entry) => entry.repo),
      blockedOwners: [...LEGACY_BLOCKED_OWNERS].sort(),
    };
  } catch {
    return { blockedRepos: [], knownInvalidRepos: [], blockedOwners: [] };
  }
}

// ---------- library data (loaded once) ----------

console.log("editool: loading library data…");
const skills = readJson<Skill[]>(paths.skills);
const skillIdSet = new Set(skills.map((s) => s.id));
const authorHandleSet = new Set(skills.map((s) => s.author_handle.toLowerCase()).filter(Boolean));
const suppressionCandidateSkillIds = new Set(skillIdSet);
for (const row of readOptionalJson<Array<{ id: string }>>(paths.cutoverSkills) ?? []) {
  suppressionCandidateSkillIds.add(row.id);
}
for (const row of readOptionalJson<{ skills: Array<{ id: string }> }>(paths.skillOverlay)?.skills ?? []) {
  suppressionCandidateSkillIds.add(row.id);
}
const goldBasketIds = new Set(
  existsSync(paths.goldBasket) ? readJson<{ id: string }[]>(paths.goldBasket).map((s) => s.id) : [],
);
type AuthorStats = {
  authorHandle: string;
  isVendor?: boolean;
  isGoat?: boolean;
  stats?: { skillCount?: number; totalStars?: number; goldBasketCount?: number };
};
const authorStats = new Map<string, AuthorStats>(
  existsSync(paths.authorLeaderboards)
    ? readJson<AuthorStats[]>(paths.authorLeaderboards).map((row) => [row.authorHandle.toLowerCase(), row])
    : [],
);
console.log(`editool: ${skills.length} skills, ${authorHandleSet.size} authors loaded`);

// ---------- validation ----------

type RemovalsSource = {
  suppressedSkills: SuppressedSkillsPolicySource;
  doNotCrawl: DoNotCrawlPolicySource;
};

function validateEditoolPolicy(replacements: Partial<PolicySources>): string[] {
  let loaded = loadPolicySources();
  for (const [key, value] of Object.entries(replacements) as Array<
    [keyof PolicySources, PolicySources[keyof PolicySources]]
  >) {
    loaded = replacePolicySource(loaded, key, value);
  }
  const existingSuppressedSkillIds = new Set(
    readJson<SuppressedSkillsPolicySource>(paths.suppressedSkills).skills.map((entry) => entry.id),
  );
  const issues = validatePolicy(loaded, {
    publishedSkillIds: skillIdSet,
    publishedAuthorHandles: authorHandleSet,
    suppressionCandidateSkillIds,
    existingSuppressedSkillIds,
  });
  return blockingPolicyIssues(issues, "editool").map((entry) => `${entry.code}: ${entry.message}`);
}

// ---------- skill search ----------

function searchSkills(query: URLSearchParams): { total: number; rows: unknown[] } {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const authors = new Set(
    query.getAll("author").map((value) => value.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
  );
  const minStars = Number(query.get("minStars") ?? 0);
  const provenance = (query.get("provenance") ?? "").trim();
  const page = Math.max(0, Number(query.get("page") ?? 0));
  const pageSize = Math.min(1000, Math.max(10, Number(query.get("pageSize") ?? 50)));

  const matches: Skill[] = [];
  for (const skill of skills) {
    if (authors.size && !authors.has(skill.author_handle.toLowerCase())) continue;
    if ((skill.stars ?? 0) < minStars) continue;
    if (provenance && (skill.provenance_type ?? "original") !== provenance) continue;
    if (q && !skill.id.toLowerCase().includes(q) && !skill.name.toLowerCase().includes(q) && !skill.description.toLowerCase().includes(q)) {
      continue;
    }
    matches.push(skill);
  }
  matches.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.id.localeCompare(b.id));

  const rows = matches.slice(page * pageSize, (page + 1) * pageSize).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description.slice(0, 180),
    author: s.author_handle,
    repo: s.github_url.replace("https://github.com/", ""),
    stars: s.stars ?? 0,
    lastUpdated: s.last_updated ?? null,
    provenance: s.provenance_type ?? "original",
    gold: goldBasketIds.has(s.id),
  }));
  return { total: matches.length, rows };
}

// ---------- git status of editable files ----------

function editableGitStatus(): { path: string; state: string }[] {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", ...editablePaths], {
      cwd: indexRoot,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ state: line.slice(0, 2).trim(), path: line.slice(3).trim() }));
  } catch {
    return [];
  }
}

// ---------- http server ----------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function hasValidSaveToken(req: IncomingMessage): boolean {
  const header = req.headers["x-editool-token"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const expected = Buffer.from(saveToken);
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validateSaveRequest(req: IncomingMessage): string[] {
  const errors: string[] = [];
  if (!isLocalOrigin(req.headers.origin)) errors.push("save request rejected: non-local Origin");
  if (!hasValidSaveToken(req)) errors.push("save request rejected: missing or invalid editool token");
  return errors;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(paths.html, "utf8").replace("</head>", `<script>window.EDITOOL_TOKEN=${JSON.stringify(saveToken)};</script>\n</head>`));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/skills") {
      sendJson(res, 200, searchSkills(url.searchParams));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/author") {
      const handle = (url.searchParams.get("handle") ?? "").toLowerCase();
      sendJson(res, 200, authorStats.get(handle) ?? null);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/curation") {
      sendJson(res, 200, {
        collections: readJson(paths.collections),
        creators: readJson(paths.creators),
        proposedCreators: readOptionalJson<ProposedCreatorsReport>(paths.proposedCreators),
        suppressedSkills: readJson(paths.suppressedSkills),
        doNotCrawl: readJson(paths.doNotCrawl),
        v2Blocklists: readV2Blocklists(),
        gitStatus: editableGitStatus(),
        library: { skillCount: skills.length, authorCount: authorHandleSet.size },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build-preview") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      if (previewServerError) {
        return sendJson(res, 503, { ok: false, errors: [previewServerError] });
      }
      if (previewBuildInProgress) {
        return sendJson(res, 409, { ok: false, errors: ["preview build already running"] });
      }

      previewBuildInProgress = true;
      try {
        const result = await buildEditoolPreview({
          repoRoot,
          indexRoot,
          sourceSiteDir: join(repoRoot, "site"),
          previewDir,
        });
        const previewOrigin = `http://${HOST}:${PREVIEW_PORT}`;
        return sendJson(res, 200, {
          ok: true,
          builtAt: result.builtAt,
          indexUrl: `${previewOrigin}${result.indexPath}`,
          profileUrls: result.profilePaths.map((path) => `${previewOrigin}${path}`),
          collectionUrls: result.collectionPaths.map((path) => `${previewOrigin}${path}`),
        });
      } finally {
        previewBuildInProgress = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/save/collections") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as CollectionsPolicySource;
      const errors = validateEditoolPolicy({ collections: body });
      if (errors.length) return sendJson(res, 422, { ok: false, errors });
      atomicWriteJson(paths.collections, body);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/save/creators") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as CreatorRegistrySource;
      const errors = validateEditoolPolicy({ creators: body });
      if (errors.length) return sendJson(res, 422, { ok: false, errors });
      atomicWrite(paths.creators, formatCreators(body));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/save/removals") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as RemovalsSource;
      const errors = validateEditoolPolicy({
        suppressedSkills: body.suppressedSkills,
        doNotCrawl: body.doNotCrawl,
      });
      if (errors.length) return sendJson(res, 422, { ok: false, errors });
      atomicWriteJson(paths.suppressedSkills, body.suppressedSkills);
      atomicWriteJson(paths.doNotCrawl, body.doNotCrawl);
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { ok: false, errors: ["not found"] });
  } catch (error) {
    sendJson(res, 500, { ok: false, errors: [error instanceof Error ? error.message : String(error)] });
  }
});

const previewServer = createEditoolPreviewServer(previewDir);
previewServer.on("error", (error) => {
  previewServerError = `preview server could not use http://${HOST}:${PREVIEW_PORT}: ${error.message}`;
  console.error(`editool: ${previewServerError}`);
});
previewServer.listen(PREVIEW_PORT, HOST, () => {
  console.log(`editool preview: http://${HOST}:${PREVIEW_PORT}`);
});

server.listen(PORT, HOST, () => {
  console.log(`editool: http://${HOST}:${PORT}`);
  console.log("editool: writes only collections.json, creators.json, suppressed-skills.json, do-not-crawl.json");
  console.log("editool: review with git diff, then commit/publish manually");
});
