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
