import { createClerkClient } from "@clerk/backend";
import { requireAuth } from "./auth.js";
import { getPgPool } from "./db.js";
import { getEnv } from "./env.js";

export type PortalUser = {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function displayName(firstName: string | null, lastName: string | null, email: string): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || email;
}

export async function requirePortalUser(req: Request): Promise<PortalUser> {
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

  const email = normalizeEmail(primaryEmail.emailAddress);
  const name = displayName(clerkUser.firstName, clerkUser.lastName, email);
  const pool = getPgPool();
  const result = await pool.query<PortalUser>(
    `
      INSERT INTO users (clerk_user_id, email, display_name, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (clerk_user_id)
      DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now()
      RETURNING id, clerk_user_id AS "clerkUserId", email, display_name AS "displayName"
    `,
    [auth.clerkUserId, email, name]
  );

  return result.rows[0];
}
