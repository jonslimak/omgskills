import type { Config, Context } from "@netlify/functions";
import { requireAuth } from "./_shared/auth.js";
import { requireSkillGroupsFeature } from "./_shared/feature-flags.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    requireSkillGroupsFeature();
    const user = await requireAuth(req);
    return jsonResponse(req, {
      ok: true,
      clerkUserId: user.clerkUserId,
      sessionId: user.sessionId
    });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Auth smoke check failed");
  }
};

export const config: Config = {
  path: "/api/portal/auth-smoke"
};
