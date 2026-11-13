import type { Context } from "@netlify/functions";
import { DeviceAuthError, deviceCredentialFromRequest } from "./_shared/device-auth.js";
import { getPgPool } from "./_shared/db.js";
import { corsHeaders, errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { parseInstallAckBody, parseInstallAckQuery, readInstallAck, recordInstallAck } from "./_shared/install-ack.js";
import { requireAuth } from "./_shared/auth.js";
import { requireSkillGroupsWebFeature } from "./_shared/feature-flags.js";
import { requireJsonObject } from "./_shared/validation.js";

const defaultDependencies = { getPgPool, requireAuth, requireSkillGroupsWebFeature, recordInstallAck, readInstallAck };

/** POST: the Mac app (device credential) received an install request. GET: the signed-in pop-over asks whether it did. */
export async function portalInstallAck(req: Request, _context: Context, dependencies = defaultDependencies) {
  const { getPgPool, requireAuth, requireSkillGroupsWebFeature, recordInstallAck, readInstallAck } = dependencies;
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST" && req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  try {
    if (req.method === "POST") {
      // Bearer syntax first, so a bad credential never reaches the database.
      deviceCredentialFromRequest(req);
      if (new URL(req.url).search) throw new Response("Install acks do not accept query parameters", { status: 400 });
      const target = parseInstallAckBody(await requireJsonObject(req));
      await recordInstallAck(getPgPool(), req, target);
      return new Response(null, { status: 204, headers: { ...corsHeaders(req), "Cache-Control": "no-store" } });
    }
    const query = parseInstallAckQuery(new URL(req.url));
    // The pop-over polls this every 1.5s, so it checks the Clerk session only (no Clerk profile load per poll).
    requireSkillGroupsWebFeature();
    const auth = await requireAuth(req);
    return secretJsonResponse(req, { acked: await readInstallAck(getPgPool(), auth.clerkUserId, query) });
  } catch (error) {
    if (error instanceof DeviceAuthError) return errorResponse(req, 401, error.message);
    if (error instanceof Response) return errorResponse(req, error.status, await error.text());
    return errorResponse(req, 500, "Install ack request failed");
  }
}

export default (req: Request, context: Context) => portalInstallAck(req, context);

export const config = {
  path: "/api/portal/install-ack",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 120,
    windowSize: 60
  }
};
