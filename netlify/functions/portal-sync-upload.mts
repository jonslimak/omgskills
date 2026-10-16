import type { Context } from "@netlify/functions";
import { DeviceAuthError } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { requireSkillGroupsWebFeature } from "./_shared/feature-flags.js";
import { errorResponse, secretJsonResponse, optionsResponse } from "./_shared/http.js";
import { parseSyncReport } from "./_shared/sync-skill.js";
import {
  performSyncUpload,
  uploadAuthenticationFromRequest
} from "./_shared/sync-upload.js";
import { requireJsonObject } from "./_shared/validation.js";

const defaultDependencies = { getPgPool, requireSkillGroupsWebFeature, performSyncUpload };

export async function portalSyncUpload(req: Request, _context: Context, dependencies = defaultDependencies) {
  const { getPgPool, requireSkillGroupsWebFeature, performSyncUpload } = dependencies;
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    requireSkillGroupsWebFeature();
    const body = await requireJsonObject(req);
    const { reportVersion, skills } = parseSyncReport(body);
    const authentication = uploadAuthenticationFromRequest(req, body);
    if (reportVersion === 2 && authentication.kind !== "device") {
      throw new Response("Presence reports require device authorization", { status: 400 });
    }

    let pool;
    try {
      pool = getPgPool();
    } catch {
      return errorResponse(req, 503, "Database is not available");
    }
    const result = await performSyncUpload(pool, authentication, skills, new Date(), reportVersion);
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
