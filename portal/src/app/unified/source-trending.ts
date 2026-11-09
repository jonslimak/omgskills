import { sourceTrendingUrl, validateSourceTrending, SOURCE_TRENDING_STALE_MS,
  type SourceTrendingEntry, type SourceTrendingFeed } from "../../../../scripts/source-trending-format.mjs";

export type SourceTrendingFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function sourceTrendingDestination(entry: Pick<SourceTrendingEntry, "source" | "skillId">) {
  const repo = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
  if (repo.test(entry.source)) {
    return { href: `https://github.com/${entry.source.split("/").map(encodeURIComponent).join("/")}`, label: "GitHub" };
  }
  const domain = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
  if (domain.test(entry.source)) return { href: `https://${entry.source.toLowerCase()}/`, label: entry.source };
  // An opaque source label is not a verified origin URL. Keep its source listing instead of guessing.
  return { href: sourceTrendingUrl(entry.source, entry.skillId), label: "skills.sh" };
}

export function sourceTrendingIsStale(feed: SourceTrendingFeed, now = Date.now()) {
  const age = now - Date.parse(feed.fetchedAt);
  return age > SOURCE_TRENDING_STALE_MS || age < -300_000;
}

export async function loadSourceTrending(signal: AbortSignal, fetcher: SourceTrendingFetcher = fetch): Promise<SourceTrendingFeed> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  for (const track of ["crawl4", "v2"]) {
    try {
      const base = `/data/${track}/`;
      const response = await fetcher(`${base}manifest.json`, { signal: combined, credentials: "omit" });
      if (!response.ok) throw new Error("Trending manifest unavailable");
      const asset = (await response.json()).sourceTrending;
      if (!asset || !/^source-trending-[a-f0-9]{12}\.json$/.test(asset.path)
        || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes)
        || asset.bytes < 1 || asset.bytes > 1_000_000) throw new Error("Source Trending unavailable");
      const result = await fetcher(base + asset.path, { signal: combined, credentials: "omit" });
      if (!result.ok) throw new Error("Trending snapshot unavailable");
      const bytes = await result.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== asset.bytes || hash !== asset.sha256) throw new Error("Trending snapshot verification failed");
      return validateSourceTrending(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch (error) {
      if (combined.aborted) throw error;
      if (track === "v2") throw new Error("Source Trending is unavailable. Try again shortly.");
    }
  }
  throw new Error("Source Trending is unavailable");
}
