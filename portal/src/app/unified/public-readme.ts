import type { SkillDisplay } from "./model";

export type ReadmeKind = "skill-readme" | "skill" | "repository";
export type SkillReadme = { markdown: string; repository: string; sourceUrl: string; truncated: boolean; kind: ReadmeKind };
export type SkillDocuments = { skill: SkillReadme | null; readme: SkillReadme | null };
const readmeKinds: readonly ReadmeKind[] = ["skill-readme", "skill", "repository"];
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function publicReadmeId(skill: SkillDisplay | null): string {
  if (!skill?.catalogId || skill.installed?.isLocalOnly || (skill.setItemKind && skill.setItemKind !== "catalog")) return "";
  return /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9_.-]+(?::[^\x00-\x1f\x7f]{1,800})?$/i.test(skill.catalogId) ? skill.catalogId : "";
}

/** Heading for the panel. A repository README only says so when it stands in for one
 * skill of a larger repo; a skill named after its repo is that repo's main skill. */
export function readmeTitle(id: string, kind: ReadmeKind) {
  if (kind === "skill") return "Skill instructions";
  const [repoPart, skillPart] = id.split(/:(.*)/s);
  const mainSkill = !skillPart || skillPart.split("/").at(-1)!.toLowerCase() === repoPart.split("/")[1]?.toLowerCase();
  return kind === "repository" && !mainSkill ? "Repository README" : "README";
}

/** GitHub page for the human docs: the skill's folder, or the repository for a root skill. */
export function readmeBrowseUrl(readme: SkillReadme) {
  const url = new URL(readme.sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const folder = parts.slice(4, -1);
  return folder.length && readme.kind !== "repository"
    ? `https://github.com/${parts[0]}/${parts[1]}/tree/${parts[3]}/${folder.join("/")}` : `https://github.com/${parts[0]}/${parts[1]}#readme`;
}

function parseDocument(data: Partial<SkillReadme> | null | undefined): SkillReadme | null {
  if (data === null || data === undefined) return null;
  if (typeof data.markdown !== "string" || !data.markdown.trim() || data.markdown.length > 20_000
    || typeof data.sourceUrl !== "string" || typeof data.repository !== "string" || typeof data.truncated !== "boolean") throw new Error("The README response was invalid.");
  const url = new URL(data.sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port
    || url.search || url.hash || parts[2] !== "blob" || parts.length < 5
    || `${parts[0]}/${parts[1]}`.toLowerCase() !== data.repository.toLowerCase()) throw new Error("The README source was invalid.");
  // Responses cached before skill-level docs carry no kind; they were repository READMEs.
  const kind = data.kind === undefined ? "repository" : data.kind;
  if (!readmeKinds.includes(kind)) throw new Error("The README response was invalid.");
  return { markdown: data.markdown, repository: data.repository, sourceUrl: url.href, truncated: data.truncated, kind };
}

type Payload = { skillId?: unknown; skill?: Partial<SkillReadme> | null; readme?: Partial<SkillReadme> | null } | null;
function payloadFor(value: unknown, id: string) {
  const payload = value as Payload;
  if (!payload || payload.skillId !== id) throw new Error("The README response did not match this skill.");
  return payload;
}

/** The single README field, validated (used for older single-document responses). */
export function parseReadme(value: unknown, id: string): SkillReadme | null {
  return parseDocument(payloadFor(value, id).readme);
}

export function parseDocuments(value: unknown, id: string): SkillDocuments | null {
  const payload = payloadFor(value, id);
  let skill = parseDocument(payload.skill);
  let readme = parseDocument(payload.readme);
  // A cached single-document response may carry the SKILL.md in the readme field.
  if (!payload.skill && readme?.kind === "skill") [skill, readme] = [readme, null];
  if (skill && skill.kind !== "skill") throw new Error("The README response was invalid.");
  if (readme?.kind === "skill") throw new Error("The README response was invalid.");
  return skill || readme ? { skill, readme } : null;
}

export class PublicReadmeClient {
  private cache = new Map<string, { expires: number; value: SkillDocuments | null }>();
  constructor(private fetcher: Fetcher = (url, init) => fetch(url, init), private now = Date.now, private timeoutMs = 20_000) {}

  async load(id: string, signal: AbortSignal): Promise<SkillDocuments | null> {
    signal.throwIfAborted();
    const hit = this.cache.get(id);
    if (hit && hit.expires > this.now()) return hit.value;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`/api/public/skill-readme?id=${encodeURIComponent(id)}`, {
        method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
        await response.body?.cancel(); throw new Error("README unavailable. Please try again.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The README response was empty.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 256_000) { await reader.cancel(); throw new Error("The README response was too large."); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = parseDocuments(JSON.parse(new TextDecoder().decode(bytes)), id);
      signal.throwIfAborted();
      this.cache.delete(id);
      // A partial upstream failure must be retried when this skill is opened again.
      if (!response.headers.get("cache-control")?.toLowerCase().includes("no-store")) {
        this.cache.set(id, { expires: this.now() + (value ? 600_000 : 60_000), value });
      }
      while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
