import type { Config, Context } from "@netlify/functions";
import { requireAuth } from "./_shared/auth.js";
import { getEnv } from "./_shared/env.js";
import { isSkillGroupsWebEnabled } from "./_shared/feature-flags.js";
import { secretJsonResponse } from "./_shared/http.js";

const defaults = { requireAuth, getEnv, isSkillGroupsWebEnabled };

export async function portalReviewAccess(req: Request, _context: Context, deps = defaults) {
  if (req.method !== "GET") {
    return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  }
  const ids = (deps.getEnv("PORTAL_REVIEW_CLERK_USER_IDS") ?? "").split(",").map((id) => id.trim());
  if (!deps.isSkillGroupsWebEnabled() || ids.length > 10
    || ids.some((id) => !/^user_[a-zA-Z0-9]+$/.test(id))) {
    return secretJsonResponse(req, { error: "Review unavailable" }, { status: 404 });
  }
  try {
    // Check the signed identity without reconciling or modifying a database account.
    const user = await deps.requireAuth(req);
    if (!ids.includes(user.clerkUserId)) {
      return secretJsonResponse(req, { error: "Review unavailable" }, { status: 404 });
    }
    return secretJsonResponse(req, { allowed: true });
  } catch (error) {
    return secretJsonResponse(req, { error: "Review unavailable" }, {
      status: error instanceof Response && error.status === 401 ? 401 : 503,
    });
  }
}

export default portalReviewAccess;
export const config: Config = { path: "/api/portal/review-access" };
