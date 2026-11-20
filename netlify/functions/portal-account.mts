import { createClerkClient } from "@clerk/backend";
import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import { AccountDeleteError, deleteAccount, type AccountDeleteDependencies } from "./_shared/account-delete.js";
import { CloudStoreError, createCloudObjectStore } from "./_shared/cloud-store.js";
import { getPgPool } from "./_shared/db.js";
import { getEnv } from "./_shared/env.js";
import { optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requirePortalUser, type PortalUser } from "./_shared/user.js";

export type PortalAccountDependencies = AccountDeleteDependencies & {
  pool(): Pool;
  requireUser(req: Request): Promise<PortalUser>;
};

const defaultDependencies: PortalAccountDependencies = {
  pool: getPgPool,
  requireUser: (req) => requirePortalUser(req),
  store() {
    try {
      return createCloudObjectStore();
    } catch (error) {
      // Without storage set up, an account with saved files can't be deleted yet (deleteAccount says so).
      if (error instanceof CloudStoreError && error.code === "not_configured") return null;
      throw error;
    }
  },
  async deleteSignIn(clerkUserId) {
    const secretKey = getEnv("CLERK_SECRET_KEY");
    if (!secretKey) throw new Error("Missing Clerk server configuration");
    await createClerkClient({ secretKey }).users.deleteUser(clerkUserId);
  }
};

/** DELETE /api/portal/account with {"confirm": "delete"}: deletes the signed-in person's account. */
export async function portalAccount(
  req: Request,
  _context: Context,
  dependencies: PortalAccountDependencies = defaultDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "DELETE") return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  try {
    const user = await dependencies.requireUser(req);
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if ((body as { confirm?: unknown } | null)?.confirm !== "delete") {
      return secretJsonResponse(req, { error: "Type delete to confirm" }, { status: 400 });
    }
    const result = await deleteAccount(dependencies.pool(), dependencies, {
      userId: user.id,
      clerkUserId: user.clerkUserId
    });
    return secretJsonResponse(req, { deleted: true, ...result });
  } catch (error) {
    if (error instanceof Response) {
      return secretJsonResponse(req, { error: await error.text() }, { status: error.status });
    }
    if (error instanceof AccountDeleteError) {
      return secretJsonResponse(req, { error: error.message, code: error.code }, { status: 503 });
    }
    return secretJsonResponse(req, { error: "Could not finish deleting your account. Some of your data may already be deleted; try again to finish." }, { status: 500 });
  }
}

export default (req: Request, context: Context) => portalAccount(req, context);

export const config: Config = {
  path: "/api/portal/account"
};
