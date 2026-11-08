import { PortalApiError } from "../api-error";
import type { PortalApi } from "../portal-api";

/** A library skill added to My skills, with what the library said about it when listed. */
export type MySkillAddition = { catalogId: string; name?: string; description?: string; author?: string; githubUrl?: string | null };

/** Library skills you added to My skills without installing them. */
export type MySkillAdditions = {
  /** Newest first. */
  skills: MySkillAddition[];
  /** Skills with a save on its way; another tap waits for it. */
  pending: string[];
  /** Details shown until the loaded library has the skill. */
  add: (catalogId: string, details?: Omit<MySkillAddition, "catalogId">) => Promise<void>;
  remove: (catalogId: string) => Promise<void>;
  /** The library skills a pasted GitHub link points at ("Add skill"). */
  findByGithubLink?: (link: string, signal?: AbortSignal) => Promise<GithubLinkSkills>;
  /** A GitHub skill that isn't in the library: what would be added, or why it can't be. */
  previewGithubSkill?: (link: string, signal?: AbortSignal) => Promise<GithubSkillPreview>;
  /** Saves that previewed version to My skills, as if a Mac had synced it. */
  addGithubSkill?: (preview: GithubSkillPreview) => Promise<{ key: string; name: string }>;
  /** A folder from this computer: what would be added, or why it can't be. */
  previewUpload?: (folder: PickedFolder, signal?: AbortSignal) => Promise<GithubSkillPreview>;
  /** Sends that folder again and saves it to My skills. */
  addUpload?: (folder: PickedFolder) => Promise<{ key: string; name: string }>;
};

/** A skill read from GitHub, pinned to a commit. `blocker` says why it can't be added (sync off, already added). */
export type GithubSkillPreview = {
  link: string; repo: string; commitSha: string; folder: string; name: string; description: string | null;
  skillMd: string; skillMdTruncated: boolean; labels: string[]; fileCount: number; totalBytes: number;
  files: { path: string; bytes: number }[]; blocker: string | null;
};

/** The library skills at a GitHub link; more when the link holds more than were listed. */
export type GithubLinkSkills = { skills: MySkillAddition[]; more: boolean };

const base = "/api/portal/my-skills";

/** The list, or null where the server doesn't offer it yet. */
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;

export async function loadMySkillAdditions(api: PortalApi, signal?: AbortSignal): Promise<MySkillAddition[] | null> {
  try {
    const value = await api<{ skills?: Record<string, unknown>[] }>(base, { signal, cache: "no-store" });
    if (!Array.isArray(value?.skills)) throw new Error("Unexpected My skills response.");
    return value.skills.flatMap(skill => typeof skill?.catalogSkillId === "string" && skill.catalogSkillId ? [{
      catalogId: skill.catalogSkillId, name: text(skill.name, 200), description: text(skill.description, 2000),
      author: text(skill.author, 200), githubUrl: text(skill.githubUrl, 500) ?? null,
    }] : []);
  } catch (error) {
    if (error instanceof PortalApiError && error.status === 404) return null;
    throw error;
  }
}

export async function addMySkill(api: PortalApi, catalogId: string) {
  await api(base, { method: "POST", body: JSON.stringify({ catalogSkillId: catalogId }) });
}

export async function removeMySkill(api: PortalApi, catalogId: string) {
  await api(`${base}?catalogSkillId=${encodeURIComponent(catalogId)}`, { method: "DELETE" });
}

/** Throws PortalApiError 400 with a message to show when it isn't a GitHub link we can read. */
export async function findSkillsAtGithubLink(api: PortalApi, link: string, signal?: AbortSignal): Promise<GithubLinkSkills> {
  const value = await api<{ skills?: Record<string, unknown>[]; more?: boolean; warning?: string }>(
    `/api/portal/catalog-search?github=${encodeURIComponent(link.trim())}`, { signal, cache: "no-store" });
  if (!Array.isArray(value?.skills) || value.warning) throw new Error("The library couldn't be checked. Try again.");
  return {
    skills: value.skills.flatMap(skill => typeof skill?.id === "string" && skill.id ? [{
      catalogId: skill.id, name: text(skill.name, 200), description: text(skill.description, 2000),
      author: skill.id.split("/")[0], githubUrl: text(skill.githubUrl, 500) ?? null,
    }] : []),
    more: value.more === true,
  };
}

/**
 * Whether text reads as a GitHub link "Add skill" can read (pasted in search, it offers Add skill):
 * a repo, a /tree/ folder or a /blob/…/SKILL.md, as the server takes them.
 */
export function looksLikeGithubLink(text: string) {
  return /^\s*(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+(\/?|\/tree\/[^\s?#]+|\/blob\/[^\s?#]+\/skill\.md)([?#]\S*)?\s*$/i.test(text);
}

/** Throws PortalApiError with the reason to show when the skill can't be read or added. */
export async function previewGithubSkill(api: PortalApi, link: string, signal?: AbortSignal): Promise<GithubSkillPreview> {
  const value = await api<Omit<GithubSkillPreview, "link">>(`/api/portal/github-skill?link=${encodeURIComponent(link.trim())}`,
    { signal, cache: "no-store" });
  if (typeof value?.name !== "string" || typeof value.commitSha !== "string" || !Array.isArray(value.files)) {
    throw new Error("GitHub couldn't be checked. Try again.");
  }
  return { ...value, link: link.trim() };
}

export async function addGithubSkill(api: PortalApi, preview: GithubSkillPreview): Promise<{ key: string; name: string }> {
  const value = await api<{ skill?: { key?: string; name?: string } }>("/api/portal/github-skill", { method: "POST",
    body: JSON.stringify({ link: preview.link, commitSha: preview.commitSha, folder: preview.folder }) });
  if (typeof value?.skill?.key !== "string") throw new Error("The skill couldn't be added. Try again.");
  return { key: value.skill.key, name: value.skill.name ?? preview.name };
}

/** A folder (or files) picked on this computer, with each file's path inside it. */
export type PickedFolder = { name: string; files: { path: string; file: File }[] };

/** Matches the server: Netlify takes up to 6 MB, with room left for the form. */
export const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;
const MAX_UPLOAD_FILES = 512;
/** What the Mac and the server leave out of a skill. */
const IGNORED = new Set([".DS_Store", ".git"]);

/**
 * The picked files as one folder. A folder picker gives paths that start with the folder's own name; that
 * name is taken off, and files picked one by one sit at the top.
 */
export function pickedFolder(list: ArrayLike<File>): PickedFolder {
  const all = Array.from(list).map(file => ({ file, parts: (file.webkitRelativePath || file.name).split("/") }));
  const top = all.length && all.every(item => item.parts.length > 1 && item.parts[0] === all[0].parts[0]) ? all[0].parts[0] : "";
  return {
    name: top,
    files: all.map(({ file, parts }) => ({ path: (top ? parts.slice(1) : parts).join("/"), file }))
      .filter(({ path }) => !path.split("/").some(part => IGNORED.has(part))),
  };
}

/** Why a picked folder can't be sent, before sending it; null when it can be. */
export function uploadProblem(folder: PickedFolder): string | null {
  if (!folder.files.length) return "That folder is empty.";
  if (folder.files.length > MAX_UPLOAD_FILES) return `That folder has ${folder.files.length} files; a skill can have up to ${MAX_UPLOAD_FILES}.`;
  if (folder.files.reduce((sum, item) => sum + item.file.size, 0) > MAX_UPLOAD_BYTES) {
    return `That folder is too big to upload here (over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB). Sync it from your Mac instead.`;
  }
  return null;
}

function uploadForm(folder: PickedFolder, add: boolean) {
  const form = new FormData();
  form.append("folder", folder.name);
  form.append("paths", JSON.stringify(folder.files.map(item => item.path)));
  for (const item of folder.files) form.append("file", item.file, item.file.name);
  if (add) form.append("add", "1");
  return form;
}

/** Throws PortalApiError with the reason to show when the folder can't be read. */
export async function previewUpload(api: PortalApi, folder: PickedFolder, signal?: AbortSignal): Promise<GithubSkillPreview> {
  const value = await api<Omit<GithubSkillPreview, "link">>("/api/portal/upload-skill",
    { method: "POST", body: uploadForm(folder, false), signal });
  if (typeof value?.name !== "string" || !Array.isArray(value.files)) throw new Error("The folder couldn't be checked. Try again.");
  return { ...value, link: "" };
}

export async function addUpload(api: PortalApi, folder: PickedFolder): Promise<{ key: string; name: string }> {
  const value = await api<{ skill?: { key?: string; name?: string } }>("/api/portal/upload-skill",
    { method: "POST", body: uploadForm(folder, true) });
  if (typeof value?.skill?.key !== "string") throw new Error("The skill couldn't be added. Try again.");
  return { key: value.skill.key, name: value.skill.name ?? folder.name };
}
