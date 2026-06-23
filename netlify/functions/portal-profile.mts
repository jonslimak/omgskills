import type { Config, Context } from "@netlify/functions";
import crypto from "node:crypto";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { isReservedHandleOrSlug } from "./_shared/reserved.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, slugify } from "./_shared/validation.js";

function randomHandle(): string {
  return `user-${crypto.randomBytes(4).toString("hex")}`;
}

async function uniqueHandle(preferred: string): Promise<string> {
  const pool = getPgPool();
  let handle = slugify(preferred);
  if (isReservedHandleOrSlug(handle)) {
    handle = randomHandle();
  }

  for (let index = 0; index < 8; index += 1) {
    const candidate = index === 0 ? handle : `${handle}-${crypto.randomBytes(2).toString("hex")}`;
    const existing = await pool.query("SELECT id FROM users WHERE handle = $1", [candidate]);
    if (existing.rowCount === 0) {
      return candidate;
    }
  }

  return randomHandle();
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET" && req.method !== "PATCH") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const pool = getPgPool();

    if (req.method === "PATCH") {
      const body = await req.json();
      const requestedHandle = optionalString(body?.handle, 80);
      const profilePublished = body?.profilePublished === true;
      let handle = requestedHandle ? slugify(requestedHandle) : null;

      if (handle && isReservedHandleOrSlug(handle)) {
        throw new Response("Handle is reserved", { status: 400 });
      }
      if (profilePublished && !handle) {
        handle = await uniqueHandle(user.email.split("@")[0] || randomHandle());
      }

      try {
        await pool.query(
          `
            UPDATE users
            SET handle = COALESCE($2, handle),
                profile_published = $3,
                handle_updated_at = CASE WHEN $2 IS NULL OR $2 = handle THEN handle_updated_at ELSE now() END,
                updated_at = now()
            WHERE id = $1
          `,
          [user.id, handle, profilePublished]
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Response("Handle is already taken", { status: 409 });
        }
        throw error;
      }
    }

    const result = await pool.query(
      `
        SELECT handle AS "handle", profile_published AS "profilePublished"
        FROM users
        WHERE id = $1
      `,
      [user.id]
    );
    const profile = result.rows[0] ?? { handle: null, profilePublished: false };

    return jsonResponse(req, {
      profile: {
        ...profile,
        publicUrl: profile.handle ? `https://omgskills.com/u/${profile.handle}` : null
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Profile request failed");
  }
};

export const config: Config = {
  path: "/api/portal/profile"
};
