import type { OmgskillsLibrary } from "../../../mcp/src/library.js";
import { loadCatalogReader, readCatalogVersion, type CatalogReadOptions, type SearchCatalogReader } from "../../../mcp/src/search-catalog.js";
import type { McpLibraryLoader, McpLibrarySnapshot, McpCatalogTrack } from "./mcp-library.js";
import { productionMcpTracks } from "./mcp-library.js";

type ReadLibrary = OmgskillsLibrary | SearchCatalogReader;
export type CompactMcpSnapshot = Omit<McpLibrarySnapshot, "library"> & { library: ReadLibrary };
export type CompactMcpLoader = Omit<McpLibraryLoader, "get" | "refresh" | "pendingRefresh"> & {
  get: () => Promise<CompactMcpSnapshot>;
  refresh: () => Promise<CompactMcpSnapshot>;
  pendingRefresh: () => Promise<CompactMcpSnapshot> | null;
};

/** Candidate-only loader. Production retains loadProductionMcpLibrary until activation is reviewed. */
export function createCompactMcpLibraryLoader(options: CatalogReadOptions & {
  tracks?: McpCatalogTrack[]; now?: () => number; maxAgeMs?: number;
} = {}): CompactMcpLoader {
  const now = options.now ?? Date.now, maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
  let snapshot: CompactMcpSnapshot | null = null;
  let pending: Promise<CompactMcpSnapshot> | null = null;
  let lastRefreshFailed = false;
  async function load() {
    let lastError: unknown;
    for (const track of options.tracks ?? productionMcpTracks) {
      try {
        if (snapshot?.library.version && snapshot.sourceTrack === track.name) {
          try {
            const latest = await readCatalogVersion(track.manifestUrl, options);
            if (latest === snapshot.library.version) return { ...snapshot, loadedAt: now() };
          } catch { /* A failed cheap check still permits a complete load of this track. */ }
        }
        const library = await loadCatalogReader(track.manifestUrl, options);
        const stats = library.getStats();
        return { library, sourceTrack: track.name, loadedAt: now(), skillCount: stats.skills,
          trendingCount: stats.trending, goldBasketCount: stats.goldBasket };
      } catch (error) { lastError = error; }
    }
    throw lastError ?? new Error("Catalog temporarily unavailable");
  }
  function refresh() {
    if (pending) return pending;
    pending = load().then(next => { snapshot = next; lastRefreshFailed = false; return next; }, error => {
      lastRefreshFailed = true;
      if (snapshot) return snapshot;
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    async get() {
      if (!snapshot) return refresh();
      if (now() - snapshot.loadedAt >= maxAgeMs) void refresh();
      return snapshot;
    },
    refresh,
    pendingRefresh: () => pending,
    status: () => ({ hasSnapshot: !!snapshot, refreshing: !!pending, lastRefreshFailed, maxAgeMs }),
  };
}
