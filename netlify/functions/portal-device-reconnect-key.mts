import type { Context } from "@netlify/functions";
import { DeviceAuthError } from "./_shared/device-auth.js";
import { bindDeviceReconnectKey, DeviceReconnectError, requireReconnectKey } from "./_shared/device-reconnect.js";
import { getPgPool } from "./_shared/db.js";
import { requireSkillGroupsWebFeature } from "./_shared/feature-flags.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requireJsonObject } from "./_shared/validation.js";

const defaultDependencies = { getPgPool, bindDeviceReconnectKey, requireSkillGroupsWebFeature };

export async function portalDeviceReconnectKey(req: Request, _context: Context, dependencies = defaultDependencies) {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  try {
    dependencies.requireSkillGroupsWebFeature();
    const body = await requireJsonObject(req);
    if (Object.keys(body).some((field) => field !== "reconnectKey")) {
      throw new DeviceReconnectError(400, "Only reconnectKey is accepted");
    }
    const key = requireReconnectKey(body.reconnectKey);
    const result = await dependencies.bindDeviceReconnectKey(dependencies.getPgPool(), req, key);
    return secretJsonResponse(req, result);
  } catch (error) {
    if (error instanceof DeviceAuthError || error instanceof DeviceReconnectError) {
      return errorResponse(req, error.status, error.message);
    }
    if (error instanceof Response) return errorResponse(req, error.status, await error.text());
    return errorResponse(req, 500, "Reconnect key binding failed");
  }
}

export default (req: Request, context: Context) => portalDeviceReconnectKey(req, context);

export const config = {
  path: "/api/portal/device-reconnect-key",
  rateLimit: { action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60 }
};
