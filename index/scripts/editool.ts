import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEditoolPreview,
  createEditoolPreviewServer,
  defaultEditoolPreviewDir,
} from "./editool-preview.js";
import type { CreatorRegistrySource } from "../scraper/creator-registry.js";
import {
  loadPolicySources,
  typedPolicySources,
} from "../scraper/policy/loader.js";
import type {
  CollectionsPolicySource,
  DoNotCrawlPolicySource,
  SuppressedSkillsPolicySource,
} from "../scraper/policy/types.js";
import {
  LEGACY_BLOCKED_OWNERS,
  LEGACY_BLOCKED_REPOS,
} from "../scraper/v2-policy.js";
import {
  prepareEditoolPolicySave,
  parseEditoolPolicyReplacements,
  type EditoolCatalogSkill,
  type EditoolPolicyReplacements,
  type EditoolPolicySourceKey,
} from "./editool-policy-save.js";
import {
  EditoolSaveBusyError,
  EditoolStaleRevisionError,
  editoolFileRevision,
  recoverEditoolPolicyTransaction,
  runEditoolPolicyTransaction,
} from "./editool-policy-transaction.js";
import {
  COLLECTION_IMAGE_MAX_BYTES,
  collectionImageFilePath,
  writeCollectionImage,
} from "./collection-images.js";
import { formatCreatorRegistry } from "./editool-creator-format.js";

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
const policyTransactionDir = join(indexRoot, ".editool-state");
let previewBuildInProgress = false;
let previewServerError: string | null = null;
const recoveredPolicyTransaction = recoverEditoolPolicyTransaction(policyTransactionDir);
if (recoveredPolicyTransaction === "rolled-back") {
  console.warn("editool: recovered and rolled back an interrupted policy save");
}

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
  site: join(repoRoot, "site"),
  collectionImages: join(repoRoot, "site", "images", "collections"),
};

// The only files POST /api/save/* may write.
const editablePolicyPaths: Record<EditoolPolicySourceKey, string> = {
  creators: paths.creators,
  collections: paths.collections,
  suppressedSkills: paths.suppressedSkills,
  doNotCrawl: paths.doNotCrawl,
};
const editablePaths = Object.values(editablePolicyPaths);
const editableStatusPaths = [
  ...editablePaths.map((path) => relative(repoRoot, path)),
  relative(repoRoot, paths.collectionImages),
];

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

function serializeEditoolPolicySource(key: EditoolPolicySourceKey, value: unknown): string {
  return key === "creators"
    ? formatCreatorRegistry(value as CreatorRegistrySource)
    : `${JSON.stringify(value, null, 2)}\n`;
}

function editoolPolicyRevisions(): Record<EditoolPolicySourceKey, string> {
  return Object.fromEntries(
    Object.entries(editablePolicyPaths).map(([key, path]) => [key, editoolFileRevision(path)]),
  ) as Record<EditoolPolicySourceKey, string>;
}

function saveEditoolPolicy(input: {
  replacements: EditoolPolicyReplacements;
  acknowledgements?: string[];
  expectedRevisions?: Partial<Record<EditoolPolicySourceKey, string>>;
}) {
  const loaded = loadPolicySources();
  const acknowledgements = new Set(input.acknowledgements ?? []);
  const prepared = prepareEditoolPolicySave({
    loaded,
    replacements: input.replacements,
    catalogContext: {
      publishedSkillIds: skillIdSet,
      publishedAuthorHandles: authorHandleSet,
      suppressionCandidateSkillIds,
    },
    catalogSkills: skills as EditoolCatalogSkill[],
    acknowledgements,
  });
  if (!prepared.ok) return prepared;

  runEditoolPolicyTransaction({
    stateDir: policyTransactionDir,
    guards: Object.values(loaded.paths).map((path) => ({
      path,
      expectedRevision: editoolFileRevision(path),
    })),
    mutations: prepared.entries.map((entry) => {
      const path = editablePolicyPaths[entry.key];
      return {
        path,
        content: serializeEditoolPolicySource(entry.key, entry.value),
        expectedRevision: input.expectedRevisions?.[entry.key] ?? editoolFileRevision(path),
      };
    }),
    verifyAfterApply: () => {
      const verified = prepareEditoolPolicySave({
        loaded: loadPolicySources(),
        replacements: input.replacements,
        catalogContext: {
          publishedSkillIds: skillIdSet,
          publishedAuthorHandles: authorHandleSet,
          suppressionCandidateSkillIds,
        },
        catalogSkills: skills as EditoolCatalogSkill[],
        acknowledgements,
      });
      if (!verified.ok) throw new Error(`post-save policy validation failed: ${verified.errors.join("; ")}`);
      execFileSync("git", ["diff", "--check", "--", ...editablePaths], {
        cwd: indexRoot,
        stdio: "pipe",
      });
    },
  });
  return {
    ok: true as const,
    savedKeys: prepared.savedKeys,
    findings: prepared.findings,
    revisions: editoolPolicyRevisions(),
  };
}

function currentEditoolPolicyFindings() {
  const loaded = loadPolicySources();
  const sources = typedPolicySources(loaded);
  return prepareEditoolPolicySave({
    loaded,
    replacements: { creators: sources.creators },
    catalogContext: {
      publishedSkillIds: skillIdSet,
      publishedAuthorHandles: authorHandleSet,
      suppressionCandidateSkillIds,
    },
    catalogSkills: skills as EditoolCatalogSkill[],
  }).findings;
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
    const out = execFileSync("git", ["status", "--porcelain", "--", ...editableStatusPaths], {
      cwd: repoRoot,
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

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`request body exceeds ${maxBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += data.length;
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePolicySaveEnvelope(value: unknown):
  | {
      replacements: EditoolPolicyReplacements;
      acknowledgements: string[];
      expectedRevisions: Partial<Record<EditoolPolicySourceKey, string>>;
      errors: [];
    }
  | { replacements: null; acknowledgements: []; expectedRevisions: {}; errors: string[] } {
  if (!isRecord(value)) {
    return { replacements: null, acknowledgements: [], expectedRevisions: {}, errors: ["policy save body must be an object"] };
  }
  const hasEnvelope = Object.hasOwn(value, "replacements");
  const parsed = parseEditoolPolicyReplacements(hasEnvelope ? value.replacements : value);
  if (!parsed.replacements) {
    return { replacements: null, acknowledgements: [], expectedRevisions: {}, errors: parsed.errors };
  }
  if (!hasEnvelope) {
    return { replacements: parsed.replacements, acknowledgements: [], expectedRevisions: {}, errors: [] };
  }
  const allowedEnvelopeKeys = new Set(["replacements", "acknowledgements", "expectedRevisions"]);
  const unknown = Object.keys(value).filter((key) => !allowedEnvelopeKeys.has(key));
  if (unknown.length) {
    return {
      replacements: null,
      acknowledgements: [],
      expectedRevisions: {},
      errors: [`unsupported policy save fields: ${unknown.sort().join(", ")}`],
    };
  }
  const acknowledgements = value.acknowledgements ?? [];
  if (!Array.isArray(acknowledgements) || acknowledgements.some((entry) => typeof entry !== "string")) {
    return { replacements: null, acknowledgements: [], expectedRevisions: {}, errors: ["acknowledgements must be strings"] };
  }
  const expectedRevisions = value.expectedRevisions ?? {};
  if (!isRecord(expectedRevisions) || Object.values(expectedRevisions).some((entry) => typeof entry !== "string")) {
    return { replacements: null, acknowledgements: [], expectedRevisions: {}, errors: ["expectedRevisions must contain revision strings"] };
  }
  const supportedRevisionKeys = new Set<string>(Object.keys(editablePolicyPaths));
  const unknownRevisionKeys = Object.keys(expectedRevisions).filter((key) => !supportedRevisionKeys.has(key));
  if (unknownRevisionKeys.length) {
    return {
      replacements: null,
      acknowledgements: [],
      expectedRevisions: {},
      errors: [`unsupported expected revision sources: ${unknownRevisionKeys.sort().join(", ")}`],
    };
  }
  return {
    replacements: parsed.replacements,
    acknowledgements,
    expectedRevisions: expectedRevisions as Partial<Record<EditoolPolicySourceKey, string>>,
    errors: [],
  };
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
        policyFindings: currentEditoolPolicyFindings(),
        policyRevisions: editoolPolicyRevisions(),
        gitStatus: editableGitStatus(),
        library: { skillCount: skills.length, authorCount: authorHandleSet.size },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/collection-image") {
      const id = url.searchParams.get("id") ?? "";
      try {
        const filePath = collectionImageFilePath(paths.site, id);
        if (!existsSync(filePath)) return sendJson(res, 404, { ok: false, errors: ["image not found"] });
        const data = readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Content-Length": data.length,
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (error) {
        return sendJson(res, 400, { ok: false, errors: [error instanceof Error ? error.message : String(error)] });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload/collection-image") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const id = url.searchParams.get("id") ?? "";
      const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/webp") {
        return sendJson(res, 415, { ok: false, errors: ["collection image upload must use image/webp"] });
      }
      const source = readJson<CollectionsPolicySource>(paths.collections);
      if (!source.collections.some((collection) => collection.id === id)) {
        return sendJson(res, 404, { ok: false, errors: [`unknown topic collection: ${id}`] });
      }
      try {
        const data = await readRawBody(req, COLLECTION_IMAGE_MAX_BYTES);
        const result = writeCollectionImage({ siteRoot: paths.site, id, data });
        return sendJson(res, 200, {
          ok: true,
          imageUrl: result.imageUrl,
          previewUrl: `/api/collection-image?id=${encodeURIComponent(id)}&v=${result.hash.slice(0, 12)}`,
          gitStatus: editableGitStatus(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendJson(res, message.includes("exceeds") ? 413 : 422, { ok: false, errors: [message] });
      }
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

    if (req.method === "POST" && url.pathname === "/api/save/policy") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const parsed = parsePolicySaveEnvelope(await readBody(req));
      if (!parsed.replacements) return sendJson(res, 422, { ok: false, errors: parsed.errors });
      try {
        const result = saveEditoolPolicy(parsed);
        return sendJson(res, result.ok ? 200 : 422, result.ok
          ? { ...result, commitReady: true, gitStatus: editableGitStatus() }
          : result);
      } catch (error) {
        if (error instanceof EditoolStaleRevisionError) {
          return sendJson(res, 409, { ok: false, errors: [error.message], stale: true });
        }
        if (error instanceof EditoolSaveBusyError) {
          return sendJson(res, 409, { ok: false, errors: [error.message], busy: true });
        }
        throw error;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/save/collections") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as CollectionsPolicySource;
      const result = saveEditoolPolicy({ replacements: { collections: body } });
      return sendJson(res, result.ok ? 200 : 422, result);
    }

    if (req.method === "POST" && url.pathname === "/api/save/creators") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as CreatorRegistrySource;
      const result = saveEditoolPolicy({ replacements: { creators: body } });
      return sendJson(res, result.ok ? 200 : 422, result);
    }

    if (req.method === "POST" && url.pathname === "/api/save/removals") {
      const requestErrors = validateSaveRequest(req);
      if (requestErrors.length) return sendJson(res, 403, { ok: false, errors: requestErrors });
      const body = (await readBody(req)) as RemovalsSource;
      const result = saveEditoolPolicy({
        replacements: {
          suppressedSkills: body.suppressedSkills,
          doNotCrawl: body.doNotCrawl,
        },
      });
      return sendJson(res, result.ok ? 200 : 422, result);
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
  console.log("editool: writes only editorial policy files and site/images/collections/*.webp");
  console.log("editool: review with git diff, then commit/publish manually");
});
