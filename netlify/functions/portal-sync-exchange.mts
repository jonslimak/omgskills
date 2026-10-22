import type { Context } from "@netlify/functions";
import { isCodeVerifier, isPairingCode } from "./_shared/crypto.js";
import { getPgPool } from "./_shared/db.js";
import { exchangePairingCode, PairingError } from "./_shared/device-pairing.js";
import { DeviceReconnectError, requireReconnectKey } from "./_shared/device-reconnect.js";
import { requireSkillGroupsWebFeature } from "./_shared/feature-flags.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requireJsonObject, requireString } from "./_shared/validation.js";

const defaultDependencies = { getPgPool, exchangePairingCode, requireSkillGroupsWebFeature };

export async function portalSyncExchange(req: Request, _context: Context, dependencies = defaultDependencies) {
  const { getPgPool, exchangePairingCode, requireSkillGroupsWebFeature } = dependencies;
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    requireSkillGroupsWebFeature();
    const body = await requireJsonObject(req);
    const pairingCode = requireString(body.pairingCode, "pairingCode", 100);
    const deviceName = requireString(body.deviceName, "deviceName", 100);
    const reconnectKey = body.reconnectKey === undefined ? undefined : requireReconnectKey(body.reconnectKey);
    const codeVerifierValue = body.codeVerifier;
    const codeVerifier = codeVerifierValue === undefined || codeVerifierValue === null
      ? null
      : codeVerifierValue;
    if (!isPairingCode(pairingCode)) {
      return errorResponse(req, 401, "Pairing code is invalid or expired");
    }
    if (codeVerifier !== null && (typeof codeVerifier !== "string" || !isCodeVerifier(codeVerifier))) {
      throw new Response("codeVerifier is invalid", { status: 400 });
    }

    const exchanged = await exchangePairingCode(getPgPool(), {
      pairingCode,
      deviceName,
      codeVerifier,
      ...(reconnectKey === undefined ? {} : { reconnectKey })
    });
    return secretJsonResponse(req, {
      credential: exchanged.credential,
      deviceId: exchanged.deviceId,
      expiresAt: exchanged.expiresAt.toISOString(),
      accountLabel: exchanged.accountLabel,
      grantedScopes: exchanged.grantedScopes,
      ...(exchanged.reconnectSupported === true ? { reconnectSupported: true } : {})
    });
  } catch (error) {
    if (error instanceof PairingError || error instanceof DeviceReconnectError) {
      return errorResponse(req, error.status, error.message);
    }
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Pairing exchange failed");
  }
}

export default (req: Request, context: Context) => portalSyncExchange(req, context);

export const config = {
  path: "/api/portal/sync-exchange",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 30,
    windowSize: 60
  }
};
