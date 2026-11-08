// "Add skill" from a folder on the person's own computer: the web sends the folder's files, and they are
// checked exactly like a skill read from GitHub (github-skill-import.ts) before being shown or saved.
import { CLOUD_SAVE_LIMITS } from "./cloud-save.js";
import { checkSkillFiles, GithubImportError, skillFolderIn, tooLarge, type GithubSkill, type GithubSkillFile } from "./github-skill-import.js";
import { gitObjectSha } from "./skill-package.js";

/** Netlify refuses request bodies over 6 MB; this leaves room for the form's own bytes. */
export const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

/** What the Mac leaves out of a synced skill (CloudSaveFolder.swift), left out here too. */
const IGNORED = new Set([".DS_Store", ".git"]);

const refused = (message: string) => new GithubImportError("unsupported_file", message);

/**
 * The skill in an uploaded folder. The form has `folder` (the picked folder's name), `paths` (a JSON list of
 * each file's path inside it) and one `file` per path, in the same order.
 */
export async function readUploadedSkill(form: FormData): Promise<GithubSkill> {
  const folderName = form.get("folder");
  const rawPaths = form.get("paths");
  const blobs = form.getAll("file");
  let paths: unknown;
  try { paths = typeof rawPaths === "string" ? JSON.parse(rawPaths) : null; } catch { paths = null; }
  if (typeof folderName !== "string" || folderName.length > 255 || !Array.isArray(paths) || paths.length !== blobs.length
    || !paths.every((path): path is string => typeof path === "string" && path.length <= 1024)
    || !blobs.every((blob): blob is File => typeof blob !== "string")) {
    throw new GithubImportError("invalid_link", "The folder couldn't be read. Choose it again.", 400);
  }
  const picked = paths.map((path, index) => ({ path, blob: blobs[index] }))
    .filter(({ path }) => !path.split("/").some(part => IGNORED.has(part)));
  if (picked.length > CLOUD_SAVE_LIMITS.maximumFileCount) throw tooLarge();
  for (const { path } of picked) {
    if (path.split("/").some(part => !part || part === "." || part === ".." || part.includes("\\"))) {
      throw refused(`"${path}" isn't a file name omgskills can save.`);
    }
  }
  const below = skillFolderIn(picked.map(item => item.path), "folder", "Choose one skill's folder.");
  const prefix = below ? `${below}/` : "";
  const inSkill = picked.filter(item => item.path.startsWith(prefix));
  let total = 0;
  for (const { path, blob } of inSkill) {
    if (blob.size > CLOUD_SAVE_LIMITS.maximumFileBytes) {
      throw new GithubImportError("too_large", `"${path.slice(prefix.length)}" is too big to add (over ${CLOUD_SAVE_LIMITS.maximumFileBytes / 1024 / 1024} MB).`, 413);
    }
    total += blob.size;
  }
  if (total > MAX_UPLOAD_BYTES) throw uploadTooLarge();
  const files = await Promise.all(inSkill.map(async ({ path, blob }): Promise<GithubSkillFile> => {
    const data = new Uint8Array(await blob.arrayBuffer());
    // A browser can't see a file's permissions; a script that starts with "#!" is taken as runnable.
    const mode = data[0] === 0x23 && data[1] === 0x21 ? "100755" : "100644";
    return { path: path.slice(prefix.length), mode, blobSha: gitObjectSha("blob", data), data };
  }));
  const folder = below ? below.split("/").at(-1)! : folderName;
  return { repo: "", commitSha: "", folder, ...checkSkillFiles(files) };
}

export const uploadTooLarge = () => new GithubImportError("too_large",
  `This folder is too big to upload here (over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB). Sync it from your Mac instead.`, 413);
