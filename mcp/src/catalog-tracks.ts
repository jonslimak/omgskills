import { defaultLibraryPaths, OmgskillsLibrary } from "./library.js";
import { loadCatalogReader } from "./search-catalog.js";
import type { CatalogReader } from "./catalog-reader.js";

export type CatalogTrack = { name: string; manifestUrl: string };

/** Published catalogs, newest first. Shared by the hosted server and the npm package. */
export const catalogTracks: CatalogTrack[] = [
  { name: "crawl4", manifestUrl: "https://omgskills.com/data/crawl4/manifest.json" },
  { name: "v2", manifestUrl: "https://omgskills.com/data/v2/manifest.json" },
  { name: "root", manifestUrl: "https://omgskills.com/data/manifest.json" }
];

/**
 * The npm package's catalog: honor each local file override independently, otherwise use
 * the same published tracks as the hosted server (or OMGSKILLS_MANIFEST_URL).
 */
export async function loadDefaultCatalog(): Promise<CatalogReader> {
  const paths = defaultLibraryPaths();
  if (paths.skillsPath && paths.trendingPath) return OmgskillsLibrary.load({ ...paths, ranking: true });
  const hasLocalOverride = !!(paths.skillsPath || paths.trendingPath || paths.goldBasketPath);
  const urls = process.env.OMGSKILLS_MANIFEST_URL ? [process.env.OMGSKILLS_MANIFEST_URL] : catalogTracks.map(track => track.manifestUrl);
  let lastError: unknown;
  for (const url of urls) {
    try {
      if (hasLocalOverride) return await OmgskillsLibrary.load({ ...paths, manifestUrl: url, ranking: true });
      return await loadCatalogReader(url, { ranking: true, goldBasketUrl: paths.goldBasketUrl });
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("Catalog unavailable");
}
