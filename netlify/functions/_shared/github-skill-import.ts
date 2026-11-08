// "Add skill" for a skill that isn't in the library: read one skill folder from a public GitHub repo,
// pinned to a commit, and check it the way cloud save checks a Mac's upload. Every refusal says why,
// in words the person can act on.
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

const tooLarge = () => new GithubImportError("too_large",
  `This skill is too big to add (up to ${CLOUD_SAVE_LIMITS.maximumFileCount} files and ${CLOUD_SAVE_LIMITS.maximumTotalBytes / 1024 / 1024} MB).`, 413);

/**
 * The SKILL.md name and description, read the way the Mac reads them (a YAML header that starts the file;
 * both text; runs of spaces squeezed), so a skill added here is the same skill on the Mac. Only plain,
 * one-line values are taken; any other form is refused with the reason rather than guessed at.
 */
export function skillMdHeader(markdown: string): { name: string; description: string } {
  const unreadable = (why: string) => new GithubImportError("no_name", `Its SKILL.md ${why}, so omgskills can't read it.`);
  if (!markdown.startsWith("---")) throw unreadable("doesn't start with a --- header");
  const after = markdown.slice(3);
  const end = after.indexOf("\n---");
  if (end < 0) throw unreadable("header isn't closed with ---");
  const lines = after.slice(0, end).split(/\r?\n/);
  const field = (key: string) => {
    const found = lines.flatMap((line, index) => line.startsWith(`${key}:`) ? [index] : []);
    if (!found.length) throw unreadable(`has no ${key}`);
    if (found.length > 1) throw unreadable(`has two ${key} lines`);
    if (/^[ \t]+\S/.test(lines[found[0] + 1] ?? "")) throw unreadable(`${key} runs over several lines`);
    let value = lines[found[0]].slice(key.length + 1).trim();
    const double = value.match(/^"([^"\\]*)"(?:[ \t]+#.*)?$/);
    const single = value.match(/^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/);
    if (double) value = double[1];
    else if (single) value = single[1].replace(/''/g, "'");
    else {
      value = value.replace(/[ \t]+#.*$/, "");
      if (!value || /^[|>\[{&*!%@`"'#]/.test(value) || /: |:$/.test(value)) throw unreadable(`${key} is in a form it doesn't take`);
      if (/^(~|null|true|false|yes|no|on|off|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+|[-+]?\.(inf|nan))$/i.test(value)) {
        throw unreadable(`${key} isn't text`);
      }
    }
    const text = value.replace(/\s+/g, " ").trim();
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
  const entries = await folderEntries(target.repoPath, target.rootTree, target.folder, options);
  const blobs = entries.filter(entry => entry.type !== "tree");
  if (!blobs.some(entry => entry.path === "SKILL.md")) {
    const nested = blobs.filter(entry => /(^|\/)SKILL\.md$/.test(entry.path ?? "")).length;
    if (nested > 1) throw new GithubImportError("several_skills",
      `This ${target.folder ? "folder" : "repo"} has ${nested} skills. Paste the link to one skill's folder.`);
    if (nested === 1) throw new GithubImportError("several_skills", "The skill is in a folder below this one. Paste the link to that folder.");
    throw new GithubImportError("no_skill", `No SKILL.md in this ${target.folder ? "folder" : "repo"}, so it isn't a skill.`);
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
    // raw.githubusercontent.com has no API quota; the hash check below proves the file is the one in the tree.
    let response: Response;
    let data: Uint8Array;
    try {
      response = await (options.fetcher ?? fetch)(
        `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${target.commitSha}/${encodePath(path)}`,
        { signal: timeLeft(options, 10_000) });
      const limited = await rateLimit(response, options);
      if (limited) throw limited;
      if (!response.ok) throw unavailable();
      data = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof GithubImportError && error.code !== "unavailable") throw error;
      throw fetchFailed(options);
    }
    if (gitObjectSha("blob", data) !== entry.sha!.toLowerCase()) throw unavailable();
    return { path: entry.path!, mode: entry.mode!, blobSha: entry.sha!.toLowerCase(), data };
  });
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
    repo: `${owner}/${repo}`, commitSha: target.commitSha, folder: target.folder, name,
    description, skillMd, labels: combineLabels(labels), files,
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
