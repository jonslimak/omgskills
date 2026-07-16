import type { Config, Context } from "@netlify/functions";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { loadPublishedSkills } from "./_shared/published-catalog.js";
import { requirePortalUser } from "./_shared/user.js";

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

    const skills = await loadPublishedSkills();
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
