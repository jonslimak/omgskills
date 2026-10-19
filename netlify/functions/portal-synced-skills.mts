import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, secretJsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { inventoryReadVersion, readSyncInventory } from "./_shared/sync-inventory-read.js";
import { requireLocalInventoryReconciliation } from "./_shared/inventory-reconciliation.js";

const defaultDependencies = { getPgPool, requirePortalUser, readSyncInventory };
type Dependencies = typeof defaultDependencies & {
  getEnvironment?: () => Record<string, string | undefined>;
  requireReconciliation?: typeof requireLocalInventoryReconciliation;
};

export async function portalSyncedSkills(req: Request, context: Context, dependencies: Dependencies = defaultDependencies) {
  const { getPgPool, requirePortalUser, readSyncInventory } = dependencies;
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const version = inventoryReadVersion(req, true);
    if (version === 3) {
      (dependencies.requireReconciliation ?? requireLocalInventoryReconciliation)(req, dependencies.getEnvironment?.() ?? process.env,
        context.deploy?.context, "/api/portal/synced-skills");
    }
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
