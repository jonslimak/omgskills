import { createClerkClient } from "@clerk/backend";
import type { QueryResult, QueryResultRow } from "pg";
import { requireAuth } from "./auth.js";
import { getPgPool } from "./db.js";
import { getEnv } from "./env.js";
import { requireSkillGroupsFeature } from "./feature-flags.js";

export type PortalUser = {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
};

export type PortalUserClient = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function displayName(firstName: string | null, lastName: string | null, email: string): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email;
}

export async function reconcilePortalUser(
  client: PortalUserClient,
  identity: { clerkUserId: string; email: string; displayName: string }
): Promise<PortalUser> {
  const existing = await client.query<PortalUser>(
    `
      UPDATE users
      SET email = $2, display_name = $3, updated_at = now()
      WHERE clerk_user_id = $1
      RETURNING id, clerk_user_id AS "clerkUserId", email, display_name AS "displayName"
    `,
    [identity.clerkUserId, identity.email, identity.displayName]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const migrated = await client.query<PortalUser>(
    `
      INSERT INTO users (clerk_user_id, email, display_name, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (email)
      DO UPDATE SET
        clerk_user_id = EXCLUDED.clerk_user_id,
        display_name = EXCLUDED.display_name,
        updated_at = now()
      RETURNING id, clerk_user_id AS "clerkUserId", email, display_name AS "displayName"
    `,
    [identity.clerkUserId, identity.email, identity.displayName]
  );
  return migrated.rows[0];
}

export async function requirePortalUser(req: Request): Promise<PortalUser> {
  requireSkillGroupsFeature();
  const auth = await requireAuth(req);
  const secretKey = getEnv("CLERK_SECRET_KEY");
  if (!secretKey) {
    throw new Response("Missing Clerk server configuration", { status: 500 });
  }

  const clerk = createClerkClient({ secretKey });
  const clerkUser = await clerk.users.getUser(auth.clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (email) => email.id === clerkUser.primaryEmailAddressId
  ) ?? clerkUser.emailAddresses[0];

  if (!primaryEmail?.emailAddress) {
    throw new Response("Signed-in user has no email address", { status: 400 });
  }
  if (primaryEmail.verification?.status !== "verified") {
    throw new Response("Signed-in user email is not verified", { status: 400 });
  }

  const email = normalizeEmail(primaryEmail.emailAddress);
  const name = displayName(clerkUser.firstName, clerkUser.lastName, email);
  return reconcilePortalUser(getPgPool(), {
    clerkUserId: auth.clerkUserId,
    email,
    displayName: name
  });
}
