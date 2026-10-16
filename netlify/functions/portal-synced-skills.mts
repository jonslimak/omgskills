import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, secretJsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { inventoryReadVersion, readSyncInventory } from "./_shared/sync-inventory-read.js";

const defaultDependencies = { getPgPool, requirePortalUser, readSyncInventory };

export async function portalSyncedSkills(req: Request, _context: Context, dependencies = defaultDependencies) {
  const { getPgPool, requirePortalUser, readSyncInventory } = dependencies;
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const version = inventoryReadVersion(req);
    const user = await requirePortalUser(req);
    return secretJsonResponse(req, await readSyncInventory(getPgPool(), user.id, version));
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to load synced skills");
  }
}

export default (req: Request, context: Context) => portalSyncedSkills(req, context);

export const config: Config = {
  path: "/api/portal/synced-skills"
};
