export const catalogSkillUrlsPath = "/catalog-skill-urls.json";

type CatalogSkillUrlsAsset = {
  version?: unknown;
  skills?: unknown;
};

export type PublicSkillLink =
  | { kind: "skillPage"; url: string }
  | { kind: "github"; url: string }
  | { kind: "metadata" };

function isGeneratedSkillPath(value: unknown): value is string {
  return typeof value === "string" && /^\/skills\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)*\/$/.test(value);
}

export function parseCatalogSkillUrlsAsset(value: unknown): Map<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Catalog skill URL asset must be an object");
  }
  const asset = value as CatalogSkillUrlsAsset;
  if (asset.version !== 1 || !asset.skills || Array.isArray(asset.skills) || typeof asset.skills !== "object") {
    throw new Error("Catalog skill URL asset has an invalid shape");
  }

  const result = new Map<string, string>();
  for (const [catalogSkillId, urlPath] of Object.entries(asset.skills)) {
    if (!catalogSkillId.trim() || !isGeneratedSkillPath(urlPath)) {
      throw new Error("Catalog skill URL asset contains an invalid entry");
    }
    result.set(catalogSkillId, urlPath);
  }
  return result;
}

export async function loadCatalogSkillUrls(
  requestUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const response = await fetcher(new URL(catalogSkillUrlsPath, requestUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Catalog skill URL asset returned ${response.status}`);
  }
  return parseCatalogSkillUrlsAsset(await response.json());
}

export function validGithubUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      pathParts.length >= 2
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function resolvePublicSkillLink(input: {
  catalogSkillId?: unknown;
  githubUrl?: unknown;
  isLocalOnly?: unknown;
}, skillUrls: ReadonlyMap<string, string>): PublicSkillLink {
  if (input.isLocalOnly === true) {
    return { kind: "metadata" };
  }

  if (typeof input.catalogSkillId === "string") {
    const publicPath = skillUrls.get(input.catalogSkillId);
    if (publicPath) {
      return { kind: "skillPage", url: publicPath };
    }
  }

  const githubUrl = validGithubUrl(input.githubUrl);
  return githubUrl
    ? { kind: "github", url: githubUrl }
    : { kind: "metadata" };
}
