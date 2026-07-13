import type { Context } from "@netlify/functions";
import { listUserDevices, revokeOwnedDevice } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deviceIdFromPath(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts.length === 4 ? parts[3] : null;
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET" && req.method !== "DELETE") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const deviceId = deviceIdFromPath(req);
    if (req.method === "GET") {
      if (deviceId) {
        return errorResponse(req, 405, "Method not allowed");
      }
      const devices = await listUserDevices(getPgPool(), user.id);
      return jsonResponse(req, { devices });
    }

    if (!deviceId || !UUID_PATTERN.test(deviceId)) {
      throw new Response("Device not found", { status: 404 });
    }
    const revokedDeviceId = await revokeOwnedDevice(getPgPool(), user.id, deviceId);
    if (!revokedDeviceId) {
      throw new Response("Device not found", { status: 404 });
    }
    return jsonResponse(req, { deviceId: revokedDeviceId, revoked: true });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Device request failed");
  }
};

export const config = {
  path: ["/api/portal/devices", "/api/portal/devices/:deviceId"],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 60,
    windowSize: 60
  }
};
