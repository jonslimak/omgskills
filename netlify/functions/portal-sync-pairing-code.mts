import type { Context } from "@netlify/functions";
import {
  browserPairingCallbackUrl,
  isBrowserPairingState
} from "./_shared/browser-pairing.js";
import { isCodeChallenge } from "./_shared/crypto.js";
import { getPgPool } from "./_shared/db.js";
import { issuePairingCode, PairingError } from "./_shared/device-pairing.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { requireJsonObject } from "./_shared/validation.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const body = await requireJsonObject(req);
    const challengeValue = body.codeChallenge;
    const methodValue = body.codeChallengeMethod;
    const stateValue = body.state;
    let codeChallenge: string | null = null;
    let browserState: string | null = null;
    if (challengeValue !== undefined || methodValue !== undefined || stateValue !== undefined) {
      if (
        typeof challengeValue !== "string"
        || !isCodeChallenge(challengeValue)
        || methodValue !== "S256"
        || !isBrowserPairingState(stateValue)
      ) {
        throw new Response("state, codeChallenge, and S256 method must be valid", { status: 400 });
      }
      codeChallenge = challengeValue;
      browserState = stateValue;
    }

    const user = await requirePortalUser(req);
    const pairing = await issuePairingCode(getPgPool(), user.id, { codeChallenge });
    return secretJsonResponse(req, browserState
      ? {
          callbackUrl: browserPairingCallbackUrl(pairing.code, browserState),
          expiresAt: pairing.expiresAt.toISOString()
        }
      : {
          pairingCode: pairing.code,
          expiresAt: pairing.expiresAt.toISOString()
        });
  } catch (error) {
    if (error instanceof PairingError) {
      return errorResponse(req, error.status, error.message);
    }
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to create pairing code");
  }
};

export const config = {
  path: "/api/portal/sync-pairing-code",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 10,
    windowSize: 60
  }
};
