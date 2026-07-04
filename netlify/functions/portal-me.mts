import type { Config, Context } from "@netlify/functions";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    const user = await requirePortalUser(req);
    return jsonResponse(req, { user });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to load current user");
  }
};

export const config: Config = {
  path: "/api/portal/me"
};
