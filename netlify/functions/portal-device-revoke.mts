import type { Context } from "@netlify/functions";
import { DeviceAuthError, revokePresentedDevice } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const deviceId = await revokePresentedDevice(getPgPool(), req);
    return jsonResponse(req, { deviceId, revoked: true });
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return errorResponse(req, error.status, error.message);
    }
    return errorResponse(req, 500, "Device revocation failed");
  }
};

export const config = {
  path: "/api/portal/device-revoke",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 20,
    windowSize: 60
  }
};
