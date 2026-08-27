import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { readPublicGroupManifestByRoute, type GroupManifestView } from "./_shared/group-manifest-adapters.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { parsePublicManifestRoute } from "./_shared/public-group-routes.js";

export type PublicGroupManifestDependencies = {
  readManifest(handle: string, groupSlug: string): Promise<GroupManifestView>;
};

function defaultDependencies(): PublicGroupManifestDependencies {
  return {
    readManifest(handle, groupSlug) {
      return readPublicGroupManifestByRoute(getPgPool(), handle, groupSlug);
    }
  };
}

export async function publicGroupManifest(
  req: Request,
  _context: Context,
  dependencies: PublicGroupManifestDependencies = defaultDependencies()
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const route = parsePublicManifestRoute(new URL(req.url).pathname);
    if (!route) {
      throw new Response("Group not found", { status: 404 });
    }
    const view = await dependencies.readManifest(route.handle, route.groupSlug);
    return jsonResponse(req, view.manifest, {
      headers: { "Cache-Control": "public, max-age=60, must-revalidate" }
    });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Manifest failed");
  }
}

export default async (req: Request, context: Context) => publicGroupManifest(req, context);

export const config: Config = {
  path: "/api/public/groups/:handle/:groupSlug/manifest"
};
