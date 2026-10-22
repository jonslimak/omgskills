import type { SkillDisplay } from "./model";

export type SkillReadme = { markdown: string; repository: string; sourceUrl: string; truncated: boolean };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function publicReadmeId(skill: SkillDisplay | null): string {
  if (!skill?.catalogId || skill.installed?.isLocalOnly || (skill.setItemKind && skill.setItemKind !== "catalog")) return "";
  return /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9_.-]+:[^\x00-\x1f\x7f]{1,800}$/i.test(skill.catalogId) ? skill.catalogId : "";
}

export function parseReadme(value: unknown, id: string): SkillReadme | null {
  const payload = value as { skillId?: unknown; readme?: Partial<SkillReadme> | null } | null;
  if (!payload || payload.skillId !== id) throw new Error("The README response did not match this skill.");
  if (payload.readme === null) return null;
  const data = payload.readme;
  if (!data || typeof data.markdown !== "string" || !data.markdown.trim() || data.markdown.length > 20_000
    || typeof data.sourceUrl !== "string" || typeof data.repository !== "string" || typeof data.truncated !== "boolean") throw new Error("The README response was invalid.");
  const url = new URL(data.sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port
    || url.search || url.hash || parts[2] !== "blob" || parts.length < 5
    || `${parts[0]}/${parts[1]}`.toLowerCase() !== data.repository.toLowerCase()) throw new Error("The README source was invalid.");
  return { markdown: data.markdown, repository: data.repository, sourceUrl: url.href, truncated: data.truncated };
}

export class PublicReadmeClient {
  private cache = new Map<string, { expires: number; value: SkillReadme | null }>();
  constructor(private fetcher: Fetcher = (url, init) => fetch(url, init), private now = Date.now, private timeoutMs = 20_000) {}

  async load(id: string, signal: AbortSignal): Promise<SkillReadme | null> {
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
          if (size > 128_000) { await reader.cancel(); throw new Error("The README response was too large."); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = parseReadme(JSON.parse(new TextDecoder().decode(bytes)), id);
      signal.throwIfAborted();
      this.cache.delete(id);
      this.cache.set(id, { expires: this.now() + (value ? 600_000 : 60_000), value });
      while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
