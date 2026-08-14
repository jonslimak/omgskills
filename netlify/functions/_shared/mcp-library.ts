import { OmgskillsLibrary } from "../../../mcp/src/library.js";

export type McpCatalogTrack = {
  name: string;
  manifestUrl: string;
};

export type McpLibrarySnapshot = {
  library: OmgskillsLibrary;
  sourceTrack: string;
  loadedAt: number;
  skillCount: number;
  trendingCount: number;
  goldBasketCount: number;
};

type McpLibraryLoaderOptions = {
  tracks?: McpCatalogTrack[];
  maxAgeMs?: number;
  now?: () => number;
  loadTrack?: (track: McpCatalogTrack) => Promise<OmgskillsLibrary>;
};

export type McpLibraryLoader = {
  get: () => Promise<McpLibrarySnapshot>;
  refresh: () => Promise<McpLibrarySnapshot>;
  pendingRefresh: () => Promise<McpLibrarySnapshot> | null;
  status: () => {
    hasSnapshot: boolean;
    refreshing: boolean;
    lastRefreshFailed: boolean;
    maxAgeMs: number;
  };
};

export const productionMcpTracks: McpCatalogTrack[] = [
  { name: "crawl4", manifestUrl: "https://omgskills.com/data/crawl4/manifest.json" },
  { name: "v2", manifestUrl: "https://omgskills.com/data/v2/manifest.json" },
  { name: "root", manifestUrl: "https://omgskills.com/data/manifest.json" }
];

export function createMcpLibraryLoader(options: McpLibraryLoaderOptions = {}): McpLibraryLoader {
  const tracks = options.tracks ?? productionMcpTracks;
  const maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  const loadTrack = options.loadTrack ?? loadProductionTrack;
  let snapshot: McpLibrarySnapshot | null = null;
  let refreshPromise: Promise<McpLibrarySnapshot> | null = null;
  let lastRefreshFailed = false;

  async function loadFreshSnapshot(): Promise<McpLibrarySnapshot> {
    let lastError: unknown;
    for (const track of tracks) {
      try {
        const library = await loadTrack(track);
        const stats = library.getStats();
        return {
          library,
          sourceTrack: track.name,
          loadedAt: now(),
          skillCount: stats.skills,
          trendingCount: stats.trending,
          goldBasketCount: stats.goldBasket
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Published MCP catalog unavailable");
  }

  function startRefresh(): Promise<McpLibrarySnapshot> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = loadFreshSnapshot()
      .then((nextSnapshot) => {
        snapshot = nextSnapshot;
        lastRefreshFailed = false;
        return nextSnapshot;
      })
      .catch((error) => {
        lastRefreshFailed = true;
        if (snapshot) return snapshot;
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  return {
    async get() {
      if (!snapshot) return startRefresh();
      if (now() - snapshot.loadedAt >= maxAgeMs) {
        void startRefresh();
      }
      return snapshot;
    },
    refresh: startRefresh,
    pendingRefresh: () => refreshPromise,
    status: () => ({
      hasSnapshot: snapshot !== null,
      refreshing: refreshPromise !== null,
      lastRefreshFailed,
      maxAgeMs
    })
  };
}

async function loadProductionTrack(track: McpCatalogTrack): Promise<OmgskillsLibrary> {
  return OmgskillsLibrary.load({
    manifestUrl: track.manifestUrl,
    fetcher: fetchWithTimeout,
    allowMissingTrending: true,
    allowMissingGoldBasket: true
  });
}

const fetchWithTimeout: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000)
  });

export const loadProductionMcpLibrary = createMcpLibraryLoader();
