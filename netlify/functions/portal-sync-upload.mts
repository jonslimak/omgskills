import type { Context } from "@netlify/functions";
import { DeviceAuthError, deviceCredentialFromRequest } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { requireSkillGroupsWebFeature } from "./_shared/feature-flags.js";
import { errorResponse, secretJsonResponse, optionsResponse } from "./_shared/http.js";
import { parseSyncReport } from "./_shared/sync-skill.js";
import {
  performSyncUpload,
  uploadAuthenticationFromRequest
} from "./_shared/sync-upload.js";
import { requireJsonObject } from "./_shared/validation.js";
import { parseInventoryCheck, performInventoryCheck, readInventoryRevision, requireInventoryReconciliation } from "./_shared/inventory-reconciliation.js";
import { requireLegacyInventoryReport } from "./_shared/legacy-inventory-schema.js";

const defaultDependencies = { getPgPool, requireSkillGroupsWebFeature, performSyncUpload };
type Dependencies = typeof defaultDependencies & {
  readInventoryRevision?: typeof readInventoryRevision;
  performInventoryCheck?: typeof performInventoryCheck;
  getEnvironment?: () => Record<string, string | undefined>;
  requireReconciliation?: typeof requireInventoryReconciliation;
};

export async function portalSyncUpload(req: Request, context: Context, dependencies: Dependencies = defaultDependencies) {
  const { getPgPool, requireSkillGroupsWebFeature, performSyncUpload } = dependencies;
  const requireReconciliation = () => (dependencies.requireReconciliation ?? requireInventoryReconciliation)(
    req, dependencies.getEnvironment?.() ?? process.env, context.deploy?.context, "/api/portal/sync-upload", context.site?.id);
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    requireSkillGroupsWebFeature();
    if (req.method === "GET") {
      if (!new URL(req.url).search) return errorResponse(req, 405, "Method not allowed");
      if (new URL(req.url).search !== "?reportVersion=3") {
        return errorResponse(req, 400, "Use the exact reportVersion=3 revision request");
      }
      requireReconciliation();
      // Validate bearer syntax before accessing the pool; the reader verifies token ownership/scopes.
      deviceCredentialFromRequest(req);
      return secretJsonResponse(req, await (dependencies.readInventoryRevision ?? readInventoryRevision)(getPgPool(), req));
    }
    if (req.headers.has("authorization")) deviceCredentialFromRequest(req);
    let body: Record<string, unknown>;
    try {
      body = await requireJsonObject(req);
    } catch (error) {
      // Legacy uploads carry their credential in JSON; unreadable JSON has no credential.
      if (!req.headers.has("authorization")) throw new DeviceAuthError();
      throw error;
    }
    const authentication = uploadAuthenticationFromRequest(req, body);
    if (body.reportVersion === 2 || body.reportVersion === 3) {
      requireReconciliation();
    } else {
      requireLegacyInventoryReport(body);
    }
    if (body.reportVersion === 3 && Object.hasOwn(body, "mode")) {
      requireReconciliation();
      if (new URL(req.url).search) throw new Response("Inventory checks do not accept query parameters", { status: 400 });
      parseInventoryCheck(body);
      deviceCredentialFromRequest(req);
      let pool;
      try { pool = getPgPool(); } catch { return errorResponse(req, 503, "Database is not available"); }
      return secretJsonResponse(req, await (dependencies.performInventoryCheck ?? performInventoryCheck)(pool, req, body));
    }
    const { reportVersion, skills, reconciliation } = parseSyncReport(body);
    if (reportVersion === 3) {
      requireReconciliation();
      if (new URL(req.url).search) throw new Response("Reconciliation uploads do not accept query parameters", { status: 400 });
    }
    if (reportVersion !== 1 && authentication.kind !== "device") {
      throw new Response("Presence reports require device authorization", { status: 400 });
    }

    let pool;
    try {
      pool = getPgPool();
    } catch {
      return errorResponse(req, 503, "Database is not available");
    }
    const result = await performSyncUpload(pool, authentication, skills, new Date(), reportVersion, reconciliation);
    return secretJsonResponse(req, result);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return errorResponse(req, error.status, error.message);
    }
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Sync upload failed");
  }
}

export default (req: Request, context: Context) => portalSyncUpload(req, context);

export const config = {
  path: "/api/portal/sync-upload",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 30,
    windowSize: 60
  }
};
