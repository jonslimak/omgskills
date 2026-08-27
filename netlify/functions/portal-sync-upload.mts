import type { Context } from "@netlify/functions";
import { DeviceAuthError } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { requireSkillGroupsFeature } from "./_shared/feature-flags.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { parseSyncSkill } from "./_shared/sync-skill.js";
import {
  performSyncUpload,
  uploadAuthenticationFromRequest
} from "./_shared/sync-upload.js";
import { requireJsonObject } from "./_shared/validation.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    requireSkillGroupsFeature();
    const body = await requireJsonObject(req);
    const authentication = uploadAuthenticationFromRequest(req, body);
    const skillsValue = body.skills;
    if (!Array.isArray(skillsValue)) {
      throw new Response("skills must be an array", { status: 400 });
    }
    if (skillsValue.length > 1000) {
      throw new Response("skills array is too large", { status: 400 });
    }

    const skills = skillsValue.map(parseSyncSkill);
    if (new Set(skills.map((skill) => skill.stableKey)).size !== skills.length) {
      throw new Response("skills contain duplicate installation locations", { status: 400 });
    }

    let pool;
    try {
      pool = getPgPool();
    } catch {
      return errorResponse(req, 503, "Database is not available");
    }
    const result = await performSyncUpload(pool, authentication, skills);
    return jsonResponse(req, result);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return errorResponse(req, error.status, error.message);
    }
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Sync upload failed");
  }
};

export const config = {
  path: "/api/portal/sync-upload",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 30,
    windowSize: 60
  }
};
