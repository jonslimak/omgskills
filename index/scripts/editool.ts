import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local-only editorial tool server. Serves editool.html and read/save endpoints
// over the curation source files. Never commits, never publishes, never touches
// the network. See editool.md at the repo root.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");

const PORT = Number(process.env.EDITOOL_PORT ?? 4980);
const HOST = "127.0.0.1";

const paths = {
  html: join(scriptDir, "editool.html"),
  skills: join(indexRoot, "skills.json"),
  goldBasket: join(indexRoot, "gold-basket.json"),
  authorLeaderboards: join(indexRoot, "author-leaderboards.json"),
  collections: join(indexRoot, "curations", "collections.json"),
  creators: join(indexRoot, "seeds", "creators.json"),
  suppressedSkills: join(indexRoot, "seeds", "suppressed-skills.json"),
  doNotCrawl: join(indexRoot, "seeds", "do-not-crawl.json"),
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

type CreatorEntry = {
  handle: string;
  roles?: string[];
  watch?: boolean;
  featured?: boolean;
  aliases?: string[];
  notes?: string;
};

type SuppressedSkillEntry = { id: string; reason: string; stagedAt: string };
type DoNotCrawlRepoEntry = { repo: string; reason: string; notes?: string };
type DoNotCrawlOwnerEntry = { owner: string; reason: string; notes?: string };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
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
function formatCreators(source: { creators: CreatorEntry[] }): string {
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

// ---------- v2 hardcoded blocklists (read-only display) ----------
// These live as constants in scraper/build.ts, not in a seed file — shown in the
// tool for visibility only; they retire with the v2 crawler.

function extractStringSet(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function readV2Blocklists(): { blockedRepos: string[]; knownInvalidRepos: string[]; blockedOwners: string[] } {
  try {
    const source = readFileSync(join(indexRoot, "scraper", "build.ts"), "utf8");
    return {
      blockedRepos: extractStringSet(source, "BLOCKED_REPOS"),
      knownInvalidRepos: extractStringSet(source, "KNOWN_INVALID_REPOS"),
      blockedOwners: extractStringSet(source, "BLOCKED_OWNERS"),
    };
  } catch {
    return { blockedRepos: [], knownInvalidRepos: [], blockedOwners: [] };
  }
}

// ---------- icon name lists (loaded once, both fully local) ----------
// SF Symbols: macOS ships the canonical name list in the CoreGlyphs bundle.
// Lucide: names + SVGs come from the lucide-static dev dependency.

function loadSfSymbolNames(): string[] {
  try {
    const out = execFileSync(
      "plutil",
      ["-convert", "json", "-o", "-", "/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources/name_availability.plist"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return Object.keys((JSON.parse(out) as { symbols: Record<string, string> }).symbols).sort();
  } catch {
    return [];
  }
}

const lucideIconsDir = join(indexRoot, "node_modules", "lucide-static", "icons");

function loadLucideNames(): string[] {
  try {
    return readdirSync(lucideIconsDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

const sfSymbolNames = loadSfSymbolNames();
const lucideNames = loadLucideNames();
const sfSymbolSet = new Set(sfSymbolNames);
const lucideSet = new Set(lucideNames);

// ---------- library data (loaded once) ----------

console.log("editool: loading library data…");
const skills = readJson<Skill[]>(paths.skills);
const skillIdSet = new Set(skills.map((s) => s.id));
const authorHandleSet = new Set(skills.map((s) => s.author_handle.toLowerCase()).filter(Boolean));
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

type CollectionsSource = {
  version?: number;
  featuredAuthors: string[];
  authorOverrides?: Record<
    string,
    { title?: string; subtitle?: string; imageUrl?: string | null; featuredSkillIds?: string[]; description?: string | null }
  >;
  collections: {
    id: string;
    type: string;
    title: string;
    subtitle: string;
    imageUrl?: string | null;
    sfSymbol?: string | null;
    lucideIcon?: string | null;
    featuredSkillIds: string[];
    skillIds: string[];
    description?: string | null;
  }[];
};

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateCollections(source: CollectionsSource): string[] {
  const errors: string[] = [];
  if (!Array.isArray(source.featuredAuthors)) errors.push("featuredAuthors must be an array");
  if (!Array.isArray(source.collections)) errors.push("collections must be an array");
  if (errors.length) return errors;

  for (const handle of source.featuredAuthors) {
    if (!authorHandleSet.has(handle.trim().toLowerCase())) {
      errors.push(`unknown featured author handle: ${handle}`);
    }
  }
  for (const [handle, override] of Object.entries(source.authorOverrides ?? {})) {
    for (const id of override.featuredSkillIds ?? []) {
      if (!skillIdSet.has(id)) errors.push(`unknown skill id in authorOverrides.${handle}: ${id}`);
    }
  }
  const seen = new Set<string>();
  for (const collection of source.collections) {
    if (!collection.id || !KEBAB_CASE.test(collection.id)) errors.push(`collection id must be kebab-case: ${collection.id}`);
    if (seen.has(collection.id)) errors.push(`duplicate collection id: ${collection.id}`);
    seen.add(collection.id);
    if (!collection.title?.trim()) errors.push(`collection ${collection.id}: title required`);
    if (!collection.subtitle?.trim()) errors.push(`collection ${collection.id}: subtitle required`);
    if (collection.sfSymbol && sfSymbolSet.size && !sfSymbolSet.has(collection.sfSymbol)) {
      errors.push(`collection ${collection.id}: unknown SF Symbol "${collection.sfSymbol}"`);
    }
    if (collection.lucideIcon && lucideSet.size && !lucideSet.has(collection.lucideIcon)) {
      errors.push(`collection ${collection.id}: unknown Lucide icon "${collection.lucideIcon}"`);
    }
    for (const id of [...(collection.featuredSkillIds ?? []), ...(collection.skillIds ?? [])]) {
      if (!skillIdSet.has(id)) errors.push(`unknown skill id in collection ${collection.id}: ${id}`);
    }
  }
  return errors;
}

function validateCreators(source: { creators: CreatorEntry[] }): string[] {
  const errors: string[] = [];
  if (!Array.isArray(source.creators)) return ["creators must be an array"];
  const seen = new Set<string>();
  for (const entry of source.creators) {
    const handle = entry.handle?.trim();
    if (!handle) {
      errors.push("creator entry with empty handle");
      continue;
    }
    const key = handle.toLowerCase();
    if (seen.has(key)) errors.push(`duplicate creator handle: ${handle}`);
    seen.add(key);
    if (entry.featured && !entry.watch) errors.push(`${handle}: featured requires watch (featured ⊆ watched)`);
    if (entry.featured && !authorHandleSet.has(key)) {
      errors.push(`${handle}: featured but not found as a catalog author`);
    }
  }
  return errors;
}

function validateRemovals(source: {
  suppressedSkills: { skills: SuppressedSkillEntry[] };
  doNotCrawl: { repos: DoNotCrawlRepoEntry[]; owners: DoNotCrawlOwnerEntry[] };
}): string[] {
  const errors: string[] = [];
  const { suppressedSkills, doNotCrawl } = source;
  if (!Array.isArray(suppressedSkills?.skills)) errors.push("suppressedSkills.skills must be an array");
  if (!Array.isArray(doNotCrawl?.repos) || !Array.isArray(doNotCrawl?.owners)) {
    errors.push("doNotCrawl must have repos and owners arrays");
  }
  if (errors.length) return errors;

  for (const entry of suppressedSkills.skills) {
    if (!entry.id?.trim()) errors.push("suppressed skill with empty id");
    if (!entry.reason?.trim()) errors.push(`suppressed skill ${entry.id}: reason required`);
  }
  for (const entry of doNotCrawl.repos) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(entry.repo ?? "")) errors.push(`do-not-crawl repo must be owner/repo: ${entry.repo}`);
    if (!entry.reason?.trim()) errors.push(`do-not-crawl repo ${entry.repo}: reason required`);
  }
  for (const entry of doNotCrawl.owners) {
    if (!entry.owner?.trim() || entry.owner.includes("/")) errors.push(`do-not-crawl owner must be a bare handle: ${entry.owner}`);
    if (!entry.reason?.trim()) errors.push(`do-not-crawl owner ${entry.owner}: reason required`);
  }
  return errors;
}

// ---------- skill search ----------

function searchSkills(query: URLSearchParams): { total: number; rows: unknown[] } {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const author = (query.get("author") ?? "").trim().toLowerCase();
  const minStars = Number(query.get("minStars") ?? 0);
  const provenance = (query.get("provenance") ?? "").trim();
  const page = Math.max(0, Number(query.get("page") ?? 0));
  const pageSize = Math.min(1000, Math.max(10, Number(query.get("pageSize") ?? 50)));

  const matches: Skill[] = [];
  for (const skill of skills) {
    if (author && skill.author_handle.toLowerCase() !== author) continue;
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
      res.end(readFileSync(paths.html, "utf8"));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/skills") {
      sendJson(res, 200, searchSkills(url.searchParams));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/icons") {
      sendJson(res, 200, { sfSymbols: sfSymbolNames, lucide: lucideNames });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/lucide/")) {
      const name = url.pathname.slice("/lucide/".length).replace(/\.svg$/, "");
      if (!lucideSet.has(name)) {
        res.writeHead(404); res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=3600" });
      res.end(readFileSync(join(lucideIconsDir, `${name}.svg`)));
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
        suppressedSkills: readJson(paths.suppressedSkills),
        doNotCrawl: readJson(paths.doNotCrawl),
        v2Blocklists: readV2Blocklists(),
        gitStatus: editableGitStatus(),
        library: { skillCount: skills.length, authorCount: authorHandleSet.size },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/save/collections") {
      const body = (await readBody(req)) as CollectionsSource;
      const errors = validateCollections(body);
      if (errors.length) return sendJson(res, 422, { ok: false, errors });
      atomicWriteJson(paths.collections, body);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/save/creators") {
      const body = (await readBody(req)) as { creators: CreatorEntry[] };
      const errors = validateCreators(body);
      if (errors.length) return sendJson(res, 422, { ok: false, errors });
      atomicWrite(paths.creators, formatCreators(body));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/save/removals") {
      const body = (await readBody(req)) as {
        suppressedSkills: { skills: SuppressedSkillEntry[] };
        doNotCrawl: { repos: DoNotCrawlRepoEntry[]; owners: DoNotCrawlOwnerEntry[] };
      };
      const errors = validateRemovals(body);
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

server.listen(PORT, HOST, () => {
  console.log(`editool: http://${HOST}:${PORT}`);
  console.log("editool: writes only collections.json, creators.json, suppressed-skills.json, do-not-crawl.json");
  console.log("editool: review with git diff, then commit/publish manually");
});
