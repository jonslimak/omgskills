import { withTimeout } from "./http.js";

export type CatalogSkill = {
  id?: string;
  name?: string;
  description?: string;
  github_url?: string;
  githubUrl?: string;
};

export type CanonicalShaEntry = {
  skillId?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

export type ShaHistoryAsset = {
  version: 1;
  shaToSkillIds: Record<string, unknown>;
  canonicalBySha?: Record<string, CanonicalShaEntry>;
};

export type PublishedCatalogIdentity = {
  track: string;
  liveSkillIds: ReadonlySet<string>;
  shaHistory: ShaHistoryAsset | null;
};

type AssetReference = {
  path?: unknown;
};

type PublishedManifest = {
  skills?: AssetReference;
  shaHistory?: AssetReference;
};

type PublishedTrack = {
  name: string;
  manifestUrl: string;
};

type LoaderOptions = {
  fetcher?: typeof fetch;
  tracks?: PublishedTrack[];
  now?: () => number;
  cacheMs?: number;
};

export const publishedCatalogTracks: PublishedTrack[] = [
  {
    name: "crawl4",
    manifestUrl: "https://omgskills.com/data/crawl4/manifest.json",
  },
  {
    name: "v2",
    manifestUrl: "https://omgskills.com/data/v2/manifest.json",
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await withTimeout(fetcher(url), 8_000);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function assetUrl(reference: AssetReference | undefined, manifestUrl: string, label: string): string {
  if (typeof reference?.path !== "string" || !reference.path.trim()) {
    throw new Error(`Manifest missing ${label} path`);
  }
  const manifest = new URL(manifestUrl);
  const asset = new URL(reference.path, manifest);
  if (asset.origin !== manifest.origin) {
    throw new Error(`Manifest ${label} path must stay on ${manifest.origin}`);
  }
  return asset.toString();
}

function parseManifest(value: unknown): PublishedManifest {
  if (!isObject(value)) {
    throw new Error("Published manifest must be an object");
  }
  return value as PublishedManifest;
}

function parseSkills(value: unknown): CatalogSkill[] {
  if (!Array.isArray(value)) {
    throw new Error("Published skills asset must be an array");
  }
  return value.filter((skill): skill is CatalogSkill => isObject(skill));
}

function parseShaHistory(value: unknown): ShaHistoryAsset {
  if (!isObject(value) || value.version !== 1 || !isObject(value.shaToSkillIds)) {
    throw new Error("Published SHA history has an invalid shape");
  }
  if (value.canonicalBySha !== undefined && !isObject(value.canonicalBySha)) {
    throw new Error("Published canonical SHA history has an invalid shape");
  }
  return value as ShaHistoryAsset;
}

export async function fetchPublishedSkills(
  options: Pick<LoaderOptions, "fetcher" | "tracks"> = {},
): Promise<CatalogSkill[]> {
  const fetcher = options.fetcher ?? fetch;
  const tracks = options.tracks ?? publishedCatalogTracks;
  for (const track of tracks) {
    try {
      const manifest = parseManifest(await fetchJson(track.manifestUrl, fetcher));
      return parseSkills(await fetchJson(assetUrl(manifest.skills, track.manifestUrl, "skills"), fetcher));
    } catch {
      // Each track is independent. Fall through to the next complete track.
    }
  }
  throw new Error("Published catalog unavailable");
}

export async function fetchPublishedCatalogIdentity(
  options: Pick<LoaderOptions, "fetcher" | "tracks"> = {},
): Promise<PublishedCatalogIdentity> {
  const fetcher = options.fetcher ?? fetch;
  const tracks = options.tracks ?? publishedCatalogTracks;
  for (const track of tracks) {
    try {
      const manifest = parseManifest(await fetchJson(track.manifestUrl, fetcher));
      const skillsPromise = fetchJson(assetUrl(manifest.skills, track.manifestUrl, "skills"), fetcher);
      const shaHistoryPromise = manifest.shaHistory
        ? fetchJson(assetUrl(manifest.shaHistory, track.manifestUrl, "shaHistory"), fetcher)
        : Promise.resolve(null);
      const [skillsValue, shaHistoryValue] = await Promise.all([skillsPromise, shaHistoryPromise]);
      const skills = parseSkills(skillsValue);
      return {
        track: track.name,
        liveSkillIds: new Set(
          skills
            .map((skill) => skill.id)
            .filter((id): id is string => typeof id === "string" && Boolean(id.trim())),
        ),
        shaHistory: shaHistoryValue === null ? null : parseShaHistory(shaHistoryValue),
      };
    } catch {
      // Do not combine skills from one track with SHA history from another.
    }
  }
  throw new Error("Published catalog identity unavailable");
}

function cachedLoader<T>(
  load: () => Promise<T>,
  now: () => number,
  cacheMs: number,
): () => Promise<T> {
  let cache: { expiresAt: number; promise: Promise<T> } | null = null;
  return async () => {
    const currentTime = now();
    if (cache && cache.expiresAt > currentTime) {
      return cache.promise;
    }
    const promise = load();
    cache = { expiresAt: currentTime + cacheMs, promise };
    try {
      return await promise;
    } catch (error) {
      if (cache?.promise === promise) {
        cache = null;
      }
      throw error;
    }
  };
}

export function createPublishedSkillsLoader(options: LoaderOptions = {}): () => Promise<CatalogSkill[]> {
  return cachedLoader(
    () => fetchPublishedSkills(options),
    options.now ?? Date.now,
    options.cacheMs ?? 5 * 60_000,
  );
}

export function createPublishedCatalogIdentityLoader(
  options: LoaderOptions = {},
): () => Promise<PublishedCatalogIdentity> {
  return cachedLoader(
    () => fetchPublishedCatalogIdentity(options),
    options.now ?? Date.now,
    options.cacheMs ?? 5 * 60_000,
  );
}

export const loadPublishedSkills = createPublishedSkillsLoader();
export const loadPublishedCatalogIdentity = createPublishedCatalogIdentityLoader();
