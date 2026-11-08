// "Add skill" for a skill that isn't in the library: read one skill folder from a public GitHub repo,
// pinned to a commit, and check it the way cloud save checks a Mac's upload. Every refusal says why,
// in words the person can act on.
import { isScalar, parseDocument, YAMLError, type Document } from "yaml";
import { CLOUD_SAVE_LIMITS } from "./cloud-save.js";
import { gitObjectSha, SkillPackageValidationError, validateSkillManifest, type SkillManifestEntry } from "./skill-package.js";
import { combineLabels, pathLabels, scanFileContents, type SkillLabel } from "./skill-scan.js";

export type GithubImportErrorCode =
  | "invalid_link" | "not_found" | "branch_not_found" | "folder_not_found" | "no_skill" | "several_skills"
  | "no_name" | "unsupported_file" | "too_large" | "secret" | "rate_limited" | "unavailable" | "sync_off" | "already_added" | "too_slow";

export class GithubImportError extends Error {
  constructor(readonly code: GithubImportErrorCode, message: string, readonly status = 422) {
    super(message);
    this.name = "GithubImportError";
  }
}

/** A link split into owner/repo and the path after /tree/ or /blob/ (ref and folder not yet told apart). */
export type GithubImportLink = { owner: string; repo: string; kind: "repo" | "tree" | "blob"; rest: string[] };

export function parseGithubImportLink(raw: string): GithubImportLink | null {
  const text = raw.trim();
  if (!text || text.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname) || url.username || url.password || url.port) return null;
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo)) return null;
  if (parts.length === 2) return { owner, repo, kind: "repo", rest: [] };
  if ((kind !== "tree" && kind !== "blob") || !rest.length) return null;
  if (kind === "blob" && (rest.length < 2 || rest.at(-1)!.toLowerCase() !== "skill.md")) return null;
  if (rest.some(part => part === "." || part === ".." || part.includes("\\"))) return null;
  return { owner, repo, kind, rest: kind === "blob" ? rest.slice(0, -1) : rest };
}

/** deadline: when the whole read must be done (ms since 1970), so the function answers before Netlify cuts it off. */
export type GithubImportOptions = { fetcher?: typeof fetch; token?: string; now?: () => number; deadline?: number };

type TreeEntry = { path?: string; mode?: string; type?: string; sha?: string; size?: number };

const API = "https://api.github.com";
const SHA = /^[0-9a-f]{40}$/;

/** The time one request may take from now: the step's own limit, cut short by the whole read's deadline. */
function timeLeft(options: GithubImportOptions, ms: number) {
  const left = options.deadline === undefined ? ms : Math.min(ms, options.deadline - (options.now ?? Date.now)());
  if (left <= 0) throw tooSlow();
  return AbortSignal.timeout(left);
}

/** A failed fetch: past the deadline it is too slow, otherwise GitHub is unreachable. */
function fetchFailed(options: GithubImportOptions) {
  return options.deadline !== undefined && (options.now ?? Date.now)() >= options.deadline ? tooSlow() : unavailable();
}

/** GitHub's limits: the hourly quota (403 with remaining 0), secondary limits (403 with retry-after or saying so), and 429. */
async function rateLimit(response: Response, options: GithubImportOptions): Promise<GithubImportError | null> {
  if (response.status !== 403 && response.status !== 429) return null;
  const limited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0"
    || response.headers.has("retry-after") || /rate limit/i.test(await response.clone().text().catch(() => ""));
  if (!limited) return null;
  const now = (options.now ?? Date.now)();
  const retry = Number(response.headers.get("retry-after"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const wait = Number.isFinite(retry) && retry > 0 ? retry * 1000 : Number.isFinite(reset) && reset > 0 ? reset * 1000 - now : NaN;
  const minutes = Number.isFinite(wait) ? Math.max(1, Math.ceil(wait / 60_000)) : null;
  return new GithubImportError("rate_limited", `GitHub is limiting requests right now. Try again${
    minutes ? ` in ${minutes} minute${minutes === 1 ? "" : "s"}` : " soon"}.`, 503);
}

async function api<T>(path: string, options: GithubImportOptions, missing: () => GithubImportError): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "omgskills-add-skill",
  };
  const token = options.token ?? process.env.GITHUB_PUBLIC_READ_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${API}${path}`, { headers, signal: timeLeft(options, 8_000) });
  } catch (error) {
    if (error instanceof GithubImportError) throw error;
    throw fetchFailed(options);
  }
  const limited = await rateLimit(response, options);
  if (limited) throw limited;
  if (response.status === 404 || response.status === 422 || response.status === 403 || response.status === 451) throw missing();
  if (!response.ok) throw unavailable();
  try {
    return await response.json() as T;
  } catch {
    throw fetchFailed(options);
  }
}

const unavailable = () => new GithubImportError("unavailable", "GitHub couldn't be reached. Try again.", 503);
const tooSlow = () => new GithubImportError("too_slow",
  "GitHub took too long to send this skill. Try again; a skill with fewer or smaller files reads faster.", 504);
const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

/** The commit and root tree the link points at, and the folder inside it. A ref may hold slashes, so each split is tried. */
async function resolveLink(link: GithubImportLink, options: GithubImportOptions) {
  const repoPath = `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}`;
  const notFound = () => new GithubImportError("not_found",
    "That repo wasn't found. Only public GitHub repos can be added.", 404);
  const repo = await api<{ private?: boolean }>(repoPath, options, notFound);
  if (repo.private) throw notFound();
  const splits = link.kind === "repo" ? [{ ref: "HEAD", folder: [] as string[] }]
    : link.rest.map((_, index) => ({ ref: link.rest.slice(0, index + 1).join("/"), folder: link.rest.slice(index + 1) }));
  for (const split of splits) {
    const commit = await api<{ sha?: string; commit?: { tree?: { sha?: string } } } | null>(
      `${repoPath}/commits/${encodePath(split.ref)}`, options, () => new GithubImportError("branch_not_found", "")).catch(error => {
      if (error instanceof GithubImportError && error.code === "branch_not_found") return null;
      throw error;
    });
    const sha = commit?.sha?.toLowerCase();
    const tree = commit?.commit?.tree?.sha?.toLowerCase();
    if (sha && tree && SHA.test(sha) && SHA.test(tree)) return { repoPath, commitSha: sha, rootTree: tree, folder: split.folder.join("/") };
  }
  throw new GithubImportError("branch_not_found", "That branch or tag wasn't found in the repo.", 404);
}

/** Every file under the folder, paths relative to it. Big repos are walked one folder at a time. */
async function folderEntries(repoPath: string, rootTree: string, folder: string, options: GithubImportOptions) {
  const folderMissing = () => new GithubImportError("folder_not_found", "That folder wasn't found in the repo.", 404);
  const full = await api<{ truncated?: boolean; tree?: TreeEntry[] }>(`${repoPath}/git/trees/${rootTree}?recursive=1`, options, folderMissing);
  if (!full.truncated) {
    const prefix = folder ? `${folder}/` : "";
    const entries = (full.tree ?? []).filter(entry => entry.path?.startsWith(prefix))
      .map(entry => ({ ...entry, path: entry.path!.slice(prefix.length) }));
    if (folder && !entries.length) throw folderMissing();
    return entries;
  }
  let tree = rootTree;
  for (const segment of folder ? folder.split("/") : []) {
    const level = await api<{ tree?: TreeEntry[] }>(`${repoPath}/git/trees/${tree}`, options, folderMissing);
    const child = level.tree?.find(entry => entry.path === segment && entry.type === "tree");
    if (!child?.sha || !SHA.test(child.sha)) throw folderMissing();
    tree = child.sha;
  }
  if (!folder) throw new GithubImportError("several_skills", "This repo is too big to read whole. Paste the link to one skill's folder.");
  const inside = await api<{ truncated?: boolean; tree?: TreeEntry[] }>(`${repoPath}/git/trees/${tree}?recursive=1`, options, folderMissing);
  if (inside.truncated) throw tooLarge();
  return inside.tree ?? [];
}

export const tooLarge = () => new GithubImportError("too_large",
  `This skill is too big to add (up to ${CLOUD_SAVE_LIMITS.maximumFileCount} files and ${CLOUD_SAVE_LIMITS.maximumTotalBytes / 1024 / 1024} MB).`, 413);

/** Yams's default resolver rules for null, bool, int, float and timestamp (Resolver.swift); a plain value matching one isn't text on the Mac. */
const YAMS_TYPED = [
  /^(?:~|null|Null|NULL|)$/,
  /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
  /^(?:[-+]?0b[0-1_]+|[-+]?0o?[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  /^(?:[-+]?(?:[0-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
  /^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)$/,
];

/**
 * The SKILL.md name and description, read the way the Mac reads them: a header that starts the file, closed
 * by the first "\n---", parsed as YAML 1.1 (as Yams does); both must be text; runs of whitespace are squeezed.
 * So a skill added here is the same skill on the Mac, and anything the Mac would skip is refused with the reason.
 */
export function skillMdHeader(markdown: string): { name: string; description: string } {
  const unreadable = (why: string) => new GithubImportError("no_name", `Its SKILL.md ${why}, so omgskills can't read it.`);
  if (!markdown.startsWith("---")) throw unreadable("doesn't start with a --- header");
  const after = markdown.slice(3);
  const end = after.indexOf("\n---");
  if (end < 0) throw unreadable("header isn't closed with ---");
  const block = after.slice(0, end);
  // The Mac's YAML reader (libyaml) refuses control characters and treats U+0085, U+2028 and U+2029 as line
  // breaks; the yaml package takes them. Both are refused here, as is a broken surrogate.
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u2028\u2029\uFFFE\uFFFF]/.test(block) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(block)) {
    throw unreadable("header has a hidden control character in it");
  }
  // Yams refuses two merge keys (<<) in one map; the yaml package merges both.
  if ((block.match(/^<<[ \t]*:/gm) ?? []).length > 1) throw unreadable("has the same field twice");
  let document: Document.Parsed;
  try {
    document = parseDocument(block, { version: "1.1", logLevel: "error" });
    if (document.errors.length) throw document.errors[0];
  } catch (error) {
    const line = error instanceof YAMLError ? error.linePos?.[0]?.line : undefined;
    const text = line ? block.split(/\r?\n/)[line - 1] ?? "" : "";
    const colon = /^\s*[\w-]+:\s*[^"'\s|>].*:\s/.test(text) ? " (text with \": \" in it needs quotes)" : "";
    if (error instanceof YAMLError && error.code === "DUPLICATE_KEY") throw unreadable(`has the same field twice${line ? ` (line ${line})` : ""}`);
    // The block starts on the opening --- line, so its line numbers are the file's.
    throw unreadable(`header isn't valid YAML${line ? ` at line ${line}` : ""}${colon}`);
  }
  let header: unknown;
  try {
    header = document.toJS({ maxAliasCount: 20 });
  } catch {
    throw unreadable("header isn't valid YAML");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw unreadable("header has no name or description");
  const field = (key: "name" | "description") => {
    // A plain (unquoted, untagged) value is typed by Yams's own rules, which differ from YAML 1.1's in places
    // (y/n are text to Yams, 0o17 a number): the text is taken as written unless Yams would make it a non-text value.
    const node = document.get(key, true);
    let value = (header as Record<string, unknown>)[key];
    if (isScalar(node) && node.type === "PLAIN" && !node.tag && typeof node.source === "string") {
      if (YAMS_TYPED.some(pattern => pattern.test(node.source as string))) throw unreadable(`${key} isn't text`);
      value = node.source;
    }
    if (value === undefined || value === null) throw unreadable(`has no ${key}`);
    if (typeof value !== "string") throw unreadable(`${key} isn't text`);
    // The Mac squeezes runs of ICU whitespace ([\t\n\f\r\p{Z}]); JavaScript's \s also takes U+FEFF, which it keeps.
    const text = value.replace(/[\t\n\f\r\p{Z}]+/gu, " ").replace(/^[\t\n\v\f\r\x85\p{Z}]+|[\t\n\v\f\r\x85\p{Z}]+$/gu, "");
    if (!text) throw unreadable(`has an empty ${key}`);
    return text;
  };
  return { name: field("name"), description: field("description") };
}

export type GithubSkillFile = { path: string; mode: string; blobSha: string; data: Uint8Array };

export type GithubSkill = {
  /** owner/repo as GitHub spells it in the link. */
  repo: string;
  commitSha: string;
  /** The skill's folder in the repo, "" at the root. */
  folder: string;
  name: string;
  description: string;
  skillMd: string;
  labels: SkillLabel[];
  files: GithubSkillFile[];
  totalBytes: number;
};

/**
 * Reads the skill a link points at. With `commitSha` and `folder` (from an earlier preview) it reads exactly
 * that version, so what is saved is what the person saw.
 */
export async function readGithubSkill(
  link: GithubImportLink,
  options: GithubImportOptions & { pinned?: { commitSha: string; folder: string } } = {},
): Promise<GithubSkill> {
  let target: { repoPath: string; commitSha: string; rootTree: string; folder: string };
  if (options.pinned) {
    const commitSha = options.pinned.commitSha.toLowerCase();
    if (!SHA.test(commitSha)) throw new GithubImportError("invalid_link", "Find the skill again, then add it.", 400);
    const repoPath = `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}`;
    const notFound = () => new GithubImportError("not_found", "That repo wasn't found. Only public GitHub repos can be added.", 404);
    if ((await api<{ private?: boolean }>(repoPath, options, notFound)).private) throw notFound();
    const commit = await api<{ tree?: { sha?: string } }>(`${repoPath}/git/commits/${commitSha}`, options,
      () => new GithubImportError("not_found", "That version is no longer on GitHub. Find the skill again.", 404));
    const rootTree = commit.tree?.sha?.toLowerCase();
    if (!rootTree || !SHA.test(rootTree)) throw unavailable();
    target = { repoPath, commitSha, rootTree, folder: options.pinned.folder };
  } else {
    target = await resolveLink(link, options);
  }
  let blobs = (await folderEntries(target.repoPath, target.rootTree, target.folder, options)).filter(entry => entry.type !== "tree");
  const below = skillFolderIn(blobs.map(entry => entry.path!), target.folder ? "folder" : "repo", "Paste the link to one skill's folder.");
  if (below) {
    const prefix = `${below}/`;
    blobs = blobs.filter(entry => entry.path!.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path!.slice(prefix.length) }));
    target = { ...target, folder: target.folder ? `${target.folder}/${below}` : below };
  }
  if (blobs.length > CLOUD_SAVE_LIMITS.maximumFileCount) throw tooLarge();
  let declared = 0;
  for (const entry of blobs) {
    if (entry.type === "commit") {
      throw new GithubImportError("unsupported_file", `"${entry.path}" is a link to another repo (a submodule), which can't be added.`);
    }
    if (entry.mode === "120000") {
      throw new GithubImportError("unsupported_file", `"${entry.path}" is a symbolic link, which can't be added.`);
    }
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755") || !entry.sha || !SHA.test(entry.sha)
      || !Number.isSafeInteger(entry.size)) {
      throw new GithubImportError("unsupported_file", `"${entry.path}" isn't a regular file, so the skill can't be added.`);
    }
    if (entry.size! > CLOUD_SAVE_LIMITS.maximumFileBytes) {
      throw new GithubImportError("too_large", `"${entry.path}" is too big to add (over ${CLOUD_SAVE_LIMITS.maximumFileBytes / 1024 / 1024} MB).`, 413);
    }
    declared += entry.size!;
    if (declared > CLOUD_SAVE_LIMITS.maximumTotalBytes) throw tooLarge();
  }
  const [owner, repo] = target.repoPath.split("/").slice(2).map(decodeURIComponent);
  const files = await mapConcurrent(blobs, 12, async (entry): Promise<GithubSkillFile> => {
    const path = target.folder ? `${target.folder}/${entry.path}` : entry.path!;
    // raw.githubusercontent.com has no API quota; the hash check proves the file is the one in the tree.
    // Its CDN now and then drops a request or serves a stale copy, so each file gets one retry.
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${target.commitSha}/${encodePath(path)}`;
    let data: Uint8Array | null = null;
    for (let attempt = 0; attempt < 2 && !data; attempt += 1) {
      try {
        const response = await (options.fetcher ?? fetch)(url, { signal: timeLeft(options, 10_000) });
        const limited = await rateLimit(response, options);
        if (limited) throw limited;
        if (response.ok) {
          const body = new Uint8Array(await response.arrayBuffer());
          if (gitObjectSha("blob", body) === entry.sha!.toLowerCase()) data = body;
        } else if (response.status < 500) throw unavailable();
      } catch (error) {
        // A refusal (limit, missing file) stands; a dropped request is retried while there is time.
        if (error instanceof GithubImportError) throw error.code === "unavailable" ? fetchFailed(options) : error;
        if (fetchFailed(options).code === "too_slow") throw tooSlow();
      }
    }
    if (!data) throw fetchFailed(options);
    return { path: entry.path!, mode: entry.mode!, blobSha: entry.sha!.toLowerCase(), data };
  });
  return { repo: `${owner}/${repo}`, commitSha: target.commitSha, folder: target.folder, ...checkSkillFiles(files) };
}

/**
 * Where the skill is among a folder's file paths: "" when SKILL.md is at the top, else the one folder below that
 * holds a SKILL.md (that is the skill meant). Several, or none, are refused.
 */
export function skillFolderIn(paths: string[], what: "folder" | "repo", pickOne: string): string {
  if (paths.includes("SKILL.md")) return "";
  const nested = paths.flatMap(path => path.endsWith("/SKILL.md") ? [path.slice(0, -"/SKILL.md".length)] : []);
  if (nested.length > 1) throw new GithubImportError("several_skills", `This ${what} has ${nested.length} skills. ${pickOne}`);
  if (!nested.length) throw new GithubImportError("no_skill", `No SKILL.md in this ${what}, so it isn't a skill.`);
  return nested[0];
}

/** A skill's files checked the way cloud save checks a Mac's upload: valid package, no secrets, a readable SKILL.md. */
export function checkSkillFiles(files: GithubSkillFile[]): Pick<GithubSkill, "name" | "description" | "skillMd" | "labels" | "files" | "totalBytes"> {
  const manifest = manifestOf(files);
  try {
    validateSkillManifest(manifest, CLOUD_SAVE_LIMITS);
  } catch (error) {
    if (error instanceof SkillPackageValidationError) {
      throw new GithubImportError("unsupported_file", `This skill's files can't be saved (${error.message}).`);
    }
    throw error;
  }
  const labels: string[][] = [];
  for (const file of files) {
    const scan = scanFileContents(file.data);
    if (scan.secrets.length) {
      throw new GithubImportError("secret",
        `"${file.path}" line ${scan.secrets[0].line} looks like a password or key (${scan.secrets[0].kind}), so the skill wasn't added.`);
    }
    labels.push(scan.labels, pathLabels(file.path, file.mode));
  }
  let skillMd: string;
  try {
    skillMd = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(files.find(file => file.path === "SKILL.md")!.data);
  } catch {
    throw new GithubImportError("no_name", "Its SKILL.md isn't UTF-8 text, so omgskills can't read it.");
  }
  const { name, description } = skillMdHeader(skillMd);
  return {
    name, description, skillMd, labels: combineLabels(labels), files,
    totalBytes: files.reduce((sum, file) => sum + file.data.byteLength, 0),
  };
}

export function manifestOf(files: GithubSkillFile[]): SkillManifestEntry[] {
  return files.map(file => ({ path: file.path, mode: file.mode, blobSha: file.blobSha, byteSize: file.data.byteLength }));
}

async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}
