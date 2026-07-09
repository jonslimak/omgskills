import type { Config, Context } from "@netlify/functions";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

type CatalogSkill = {
  id?: string;
  name?: string;
  description?: string;
  github_url?: string;
  githubUrl?: string;
};

const DATA_MANIFESTS = [
  "https://omgskills.com/data/crawl4/manifest.json",
  "https://omgskills.com/data/v2/manifest.json"
];

async function fetchJson<T>(url: string): Promise<T> {
  const response = await withTimeout(fetch(url), 8000);
  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchSkills() {
  for (const manifestUrl of DATA_MANIFESTS) {
    try {
      const manifest = await fetchJson<{ skills?: { path?: string } }>(manifestUrl);
      const path = manifest.skills?.path;
      if (!path) {
        throw new Error("Manifest missing skills path");
      }
      return await fetchJson<CatalogSkill[]>(new URL(path, manifestUrl).toString());
    } catch {
      // Try next hosted manifest. Catalog lookup is non-blocking by design.
    }
  }

  throw new Error("Catalog unavailable");
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    await requirePortalUser(req);
    const query = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (query.length < 2) {
      return jsonResponse(req, { skills: [] });
    }

    const skills = await fetchSkills();
    const results = skills
      .filter((skill) => {
        const haystack = `${skill.id ?? ""} ${skill.name ?? ""} ${skill.description ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 12)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description ?? null,
        githubUrl: skill.github_url ?? skill.githubUrl ?? null
      }));

    return jsonResponse(req, { skills: results });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return jsonResponse(req, { skills: [], warning: "Catalog lookup unavailable" });
  }
};

export const config: Config = {
  path: "/api/portal/catalog-search"
};
