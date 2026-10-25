export type CreatorProfileSummary = {
  description: string;
  githubUrl?: string;
  xUrl?: string;
  skillCount?: number;
  totalStars?: number;
  totalInstalls?: number;
  bestSkill?: { id: string; name: string };
  rankings: { category: string; rank: number; value: string }[];
};
export const rankingLabels: Record<string, string> = {
  influential: "Influential", "most-used": "Most-used", peak: "Peak",
  consistent: "Consistent", prolific: "Prolific", efficient: "Efficient",
};
type SummaryMap = Record<string, CreatorProfileSummary>;

function link(value: unknown, hosts: string[]) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password
      && /^\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\/?$/.test(url.pathname) && !url.search && !url.hash) return url.href;
  } catch { /* Optional profile links are never required for the banner. */ }
  return undefined;
}

export function parseCreatorProfiles(value: unknown): SummaryMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid creator summary.");
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== 1 || !envelope.profiles || typeof envelope.profiles !== "object" || Array.isArray(envelope.profiles)) throw new Error("Invalid creator summary.");
  const entries = Object.entries(envelope.profiles);
  if (entries.length > 1000) throw new Error("Creator summary is too large.");
  const result: SummaryMap = Object.create(null);
  for (const [handle, source] of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(handle) || !source || typeof source !== "object" || Array.isArray(source)) throw new Error("Invalid creator profile.");
    const row = source as Record<string, unknown>;
    const count = (key: string) => typeof row[key] === "number" && Number.isSafeInteger(row[key]) && row[key] >= 0 ? row[key] as number : undefined;
    const best = row.bestSkill as Record<string, unknown> | undefined;
    result[handle] = {
      description: typeof row.description === "string" ? row.description.slice(0, 5000) : "",
      githubUrl: link(row.githubUrl, ["github.com"]), xUrl: link(row.xUrl, ["x.com", "twitter.com"]),
      skillCount: count("skillCount"), totalStars: count("totalStars"), totalInstalls: count("totalInstalls"),
      bestSkill: best && typeof best.id === "string" && typeof best.name === "string" ? { id: best.id, name: best.name.slice(0, 300) } : undefined,
      rankings: Array.isArray(row.rankings) ? row.rankings.filter((badge): badge is CreatorProfileSummary["rankings"][number] =>
        badge && typeof badge === "object" && Object.hasOwn(rankingLabels, badge.category) && Number.isSafeInteger(badge.rank) && badge.rank > 0 && typeof badge.value === "string"
      ).slice(0, 3).map(badge => ({ category: badge.category, rank: badge.rank, value: badge.value.slice(0, 300) })) : [],
    };
  }
  return result;
}

export function createCreatorProfileLoader(fetcher: typeof fetch = (input, init) => fetch(input, init), now = Date.now) {
  let cached: { at: number; promise: Promise<SummaryMap> } | undefined;
  return function load(): Promise<SummaryMap> {
    if (cached && now() - cached.at < 600_000) return cached.promise;
    const promise = (async () => {
      const response = await fetcher("/app/creator-profiles.json", {
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Creator summary unavailable.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Creator summary unavailable.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_000_000) { await reader.cancel(); throw new Error("Creator summary is too large."); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return parseCreatorProfiles(JSON.parse(new TextDecoder().decode(bytes)));
    })();
    const entry = { at: now(), promise };
    cached = entry;
    void promise.catch(() => { if (cached === entry) cached = undefined; });
    return promise;
  };
}
export const loadCreatorProfiles = createCreatorProfileLoader();
