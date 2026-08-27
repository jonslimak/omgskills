import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { readMemberGroupManifest, type GroupManifestView } from "./_shared/group-manifest-adapters.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requirePortalUser, type PortalUser } from "./_shared/user.js";

function groupIdFromPath(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts.length === 5 && parts[4] === "manifest" ? parts[3] : null;
}

export type PortalGroupManifestDependencies = {
  requirePortalUser(req: Request): Promise<PortalUser>;
  readManifest(actor: PortalUser, groupId: string): Promise<GroupManifestView>;
};

function defaultDependencies(): PortalGroupManifestDependencies {
  return {
    requirePortalUser,
    readManifest(actor, groupId) {
      return readMemberGroupManifest(getPgPool(), actor, groupId);
    }
  };
}

export async function portalGroupManifest(
  req: Request,
  _context: Context,
  dependencies: PortalGroupManifestDependencies = defaultDependencies()
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Group not found", { status: 404 });
    }
    const actor = await dependencies.requirePortalUser(req);
    const view = await dependencies.readManifest(actor, groupId);
    return secretJsonResponse(req, view.manifest);
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Manifest failed");
  }
}

export default async (req: Request, context: Context) => portalGroupManifest(req, context);

export const config: Config = {
  path: "/api/portal/groups/:groupId/manifest"
};
