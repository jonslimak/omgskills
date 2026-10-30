import { z } from "zod";
import type { SkillResult } from "./library.js";
import { gitBlobSha, pinnedInstallFor } from "./install.js";

const sha = /^[a-f0-9]{40}$/i;
export const inspectionLimits = { files: 20, selectedFiles: 10, fileBytes: 64 * 1024,
  totalFileBytes: 256 * 1024, metadataBytes: 256 * 1024, totalMetadataBytes: 1024 * 1024,
  totalCharacters: 32_000, timeoutMs: 10_000 } as const;
export class FileInspectionError extends Error {}

export function safeFilePath(path: string) {
  const parts = path.split("/");
  return path.length > 0 && path.length <= 500 && parts.length <= 12
    && parts.every(part => part !== "." && part !== ".." && /^[^/\\\x00-\x1f\x7f]+$/.test(part));
}

const entrySchema = z.object({ path: z.string().refine(safeFilePath), mode: z.string(), type: z.enum(["blob", "tree", "commit"]),
  sha: z.string().regex(sha), size: z.number().int().nonnegative().optional() });
const treeSchema = z.object({ sha: z.string().regex(sha), tree: z.array(entrySchema).max(1000), truncated: z.boolean() });
type Entry = z.infer<typeof entrySchema>;
export type InspectedFile = { path: string; bytes?: number; sha?: string; content?: string;
  hash_verified?: boolean; truncated?: boolean; read_error?: string };
export type Inspection = { id: string; ref: string; path: string; pinned: true; files: InspectedFile[];
  listing_truncated: boolean; total_files?: number; skipped_entries: number };
type Budget = { metadata: number; files: number };

async function readBytes(url: string, kind: "metadata" | "files", budget: Budget, signal: AbortSignal, fetcher: typeof fetch) {
  signal.throwIfAborted();
  const response = await fetcher(url, { redirect: "manual", credentials: "omit", signal,
    headers: { Accept: kind === "metadata" ? "application/vnd.github+json" : "text/plain", "User-Agent": "omgskills-mcp" } });
  const cancel = () => response.body?.cancel().catch(() => {});
  if ((response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) {
    await cancel(); throw new FileInspectionError("GitHub redirected the pinned request; not following it.");
  }
  if (!response.ok) {
    await cancel();
    throw new FileInspectionError(response.status === 403 || response.status === 429
      ? "GitHub denied or rate-limited the read. Retry later."
      : `GitHub returned ${response.status}; the pinned files could not be read.`);
  }
  const max = Math.min(kind === "metadata" ? inspectionLimits.metadataBytes : inspectionLimits.fileBytes, budget[kind]);
  const declared = response.headers.get("content-length");
  if (max <= 0 || (declared !== null && Number(declared) > max)) {
    await cancel(); throw new FileInspectionError("Pinned response exceeds the inspection byte limit.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      budget[kind] -= next.value.byteLength;
      size += next.value.byteLength;
      if (size > max) throw new FileInspectionError("Pinned response exceeds the inspection byte limit.");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

/** Lists a folder resolved from the recorded commit; optional reads are inert UTF-8 text. */
export async function inspectSkillFiles(skill: SkillResult, options: { max_files: number; max_chars: number; paths?: string[] }, fetcher: typeof fetch = fetch): Promise<Inspection> {
  const pin = pinnedInstallFor(skill);
  if (!pin) throw new FileInspectionError("File inspection requires a pinned commit and SKILL.md hash. No default-branch fallback is allowed.");
  if (!Number.isInteger(options.max_files) || options.max_files < 1 || options.max_files > inspectionLimits.files
    || !Number.isInteger(options.max_chars) || options.max_chars < 1 || options.max_chars > 8000
    || (options.paths && (options.paths.length > inspectionLimits.selectedFiles || options.paths.length > options.max_files || options.paths.some(path => !safeFilePath(path)))))
    throw new FileInspectionError("Use at most 20 listed files and 10 safe relative paths, within max_files, with max_chars from 1 to 8000.");
  const directories = pin.path.split("/");
  if (directories.length > 8) throw new FileInspectionError("The recorded skill folder exceeds the inspection depth limit.");
  const signal = AbortSignal.timeout(inspectionLimits.timeoutMs);
  const budget: Budget = { metadata: inspectionLimits.totalMetadataBytes, files: inspectionLimits.totalFileBytes };
  try {
    const tree = async (ref: string, recursive = false) => {
      const bytes = await readBytes(`https://api.github.com/repos/${pin.repo}/git/trees/${ref}${recursive ? "?recursive=1" : ""}`, "metadata", budget, signal, fetcher);
      const parsed = treeSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (!parsed.success) throw new FileInspectionError("GitHub returned invalid or oversized tree metadata.");
      const value = parsed.data;
      if (ref !== pin.commit_sha && value.sha.toLowerCase() !== ref)
        throw new FileInspectionError("GitHub returned the wrong pinned tree.");
      if (new Set(value.tree.map(entry => entry.path)).size !== value.tree.length)
        throw new FileInspectionError("GitHub returned ambiguous tree paths.");
      return value;
    };
    // Resolve every parent from the pinned commit, rather than trusting a loose tree SHA.
    let ref = pin.commit_sha;
    for (const directory of directories) {
      const parent = await tree(ref);
      if (parent.truncated) throw new FileInspectionError("GitHub truncated a parent tree; cannot verify the skill folder.");
      const entry = parent.tree.find(entry => entry.path === directory);
      if (!entry || entry.type !== "tree" || entry.mode !== "040000")
        throw new FileInspectionError("The pinned skill path is missing or traverses a symlink/submodule.");
      ref = entry.sha.toLowerCase();
    }
    if (pin.skill_tree_sha && ref !== pin.skill_tree_sha)
      throw new FileInspectionError("The skill folder at the pinned commit does not match the catalog tree hash.");
    const listing = await tree(ref, true);
    if (listing.sha.toLowerCase() !== ref) throw new FileInspectionError("GitHub returned the wrong pinned tree.");
    const regular = (entry: Entry) => entry.type === "blob" && ["100644", "100755"].includes(entry.mode);
    const blocked = listing.tree.filter(entry => !regular(entry) && !(entry.type === "tree" && entry.mode === "040000"));
    const files = listing.tree.filter(entry => regular(entry) && !blocked.some(parent => entry.path.startsWith(`${parent.path}/`)));
    const skillMd = files.find(entry => entry.path === "SKILL.md");
    if (!skillMd || skillMd.sha.toLowerCase() !== pin.skill_md_sha)
      throw new FileInspectionError("SKILL.md in the pinned tree does not match the catalog hash.");
    const wanted = [...new Set(options.paths ?? [])];
    const selected = wanted.length ? wanted.map(path => files.find(entry => entry.path === path) ?? { path }) : files.slice(0, options.max_files);
    let charactersLeft: number = inspectionLimits.totalCharacters;
    const output: InspectedFile[] = [];
    for (const entry of selected) {
      const file: InspectedFile = { path: entry.path, ...("sha" in entry ? { sha: entry.sha, bytes: entry.size } : {}) };
      output.push(file);
      if (!wanted.length) continue;
      if (!("sha" in entry)) { file.read_error = "Not a listed regular file at this pinned commit; links and submodules are not read."; continue; }
      if ((entry.size !== undefined && entry.size > Math.min(inspectionLimits.fileBytes, budget.files)) || budget.files <= 0 || charactersLeft <= 0) {
        file.read_error = "File exceeds the remaining inspection budget."; continue;
      }
      try {
        const path = `${pin.path}/${entry.path}`.split("/").map(encodeURIComponent).join("/");
        const bytes = await readBytes(`https://raw.githubusercontent.com/${pin.repo}/${pin.commit_sha}/${path}`, "files", budget, signal, fetcher);
        if (gitBlobSha(bytes) !== entry.sha.toLowerCase()) throw new FileInspectionError("File content does not match its pinned blob hash.");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new FileInspectionError("File is not plain UTF-8 text.");
        const characters = Array.from(text), max = Math.min(options.max_chars, charactersLeft);
        file.content = characters.slice(0, max).join("");
        file.hash_verified = true; file.truncated = characters.length > max;
        charactersLeft -= Math.min(characters.length, max);
      } catch (error) {
        file.read_error = error instanceof FileInspectionError ? error.message : "Text could not be read within the inspection limits.";
      }
    }
    return { id: skill.id, ref: pin.commit_sha, path: pin.path, pinned: true, files: output,
      listing_truncated: listing.truncated || files.length > output.length,
      ...(!listing.truncated ? { total_files: files.length } : {}), skipped_entries: listing.tree.length - files.length };
  } catch (error) {
    throw error instanceof FileInspectionError ? error : new FileInspectionError("Pinned files could not be read within the inspection limits. Retry later.");
  }
}
