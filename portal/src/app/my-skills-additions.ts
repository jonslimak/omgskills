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
  add: (catalogId: string) => Promise<void>;
  remove: (catalogId: string) => Promise<void>;
};

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
