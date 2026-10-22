import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { requireLegacyInventoryRead } from "./_shared/legacy-inventory-schema.js";
import { readLegacySyncInventory } from "./_shared/sync-inventory.js";

const defaultDependencies = { getPgPool, requirePortalUser, readLegacySyncInventory };

export async function portalSyncedSkills(req: Request, _context: Context, dependencies = defaultDependencies) {
  const { getPgPool, requirePortalUser, readLegacySyncInventory } = dependencies;
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    requireLegacyInventoryRead(req);
    const user = await requirePortalUser(req);
    return jsonResponse(req, await readLegacySyncInventory(getPgPool(), user.id));
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
