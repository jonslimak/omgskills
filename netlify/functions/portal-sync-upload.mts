import type { Config, Context } from "@netlify/functions";
import { hashToken } from "./_shared/crypto.js";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { optionalString, requireString } from "./_shared/validation.js";

type SyncSkill = {
  stableKey: string;
  skillMdSha: string | null;
  identityStatus: "resolved" | "ambiguous" | "localOnly";
  name: string;
  description: string | null;
  catalogSkillId: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
};

function parseIdentityStatus(
  value: unknown,
  catalogSkillId: string | null,
  isLocalOnly: boolean
): SyncSkill["identityStatus"] {
  if (value === "resolved" || value === "ambiguous" || value === "localOnly") {
    return value;
  }
  if (catalogSkillId) {
    return "resolved";
  }
  return isLocalOnly ? "localOnly" : "ambiguous";
}

function parseSkill(value: unknown): SyncSkill {
  if (!value || typeof value !== "object") {
    throw new Response("Each skill must be an object", { status: 400 });
  }
  const record = value as Record<string, unknown>;
  const name = requireString(record.name, "name", 200);
  const githubUrl = optionalString(record.githubUrl, 500);
  const catalogSkillId = optionalString(record.catalogSkillId, 500);
  const isLocalOnly = record.isLocalOnly === true;
  const fallbackStableKey = requireString(record.stableKey, "stableKey", 1000);
  return {
    stableKey: githubUrl ? `${githubUrl}#${name}` : fallbackStableKey,
    skillMdSha: optionalString(record.skillMdSha, 80),
    identityStatus: parseIdentityStatus(record.identityStatus, catalogSkillId, isLocalOnly),
    name,
    description: optionalString(record.description, 2000),
    catalogSkillId,
    githubUrl,
    isLocalOnly,
    source: requireString(record.source, "source", 40)
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const body = await req.json();
    const token = requireString(body?.token, "token", 500);
    const skillsValue = body?.skills;
    if (!Array.isArray(skillsValue)) {
      throw new Response("skills must be an array", { status: 400 });
    }
    if (skillsValue.length > 1000) {
      throw new Response("skills array is too large", { status: 400 });
    }

    const skills = skillsValue.map(parseSkill);
    let pool;
    try {
      pool = getPgPool();
    } catch {
      return errorResponse(req, 503, "Database is not available");
    }
    let client;
    try {
      client = await pool.connect();
    } catch {
      return errorResponse(req, 503, "Database is not available");
    }
    try {
      await client.query("BEGIN");
      const tokenResult = await client.query<{ id: string; user_id: string }>(
        `
          SELECT id, user_id
          FROM sync_tokens
          WHERE token_hash = $1
            AND used_at IS NULL
            AND expires_at > now()
          FOR UPDATE
        `,
        [hashToken(token)]
      );

      const syncToken = tokenResult.rows[0];
      if (!syncToken) {
        throw new Response("Sync token is invalid or expired", { status: 401 });
      }

      const runResult = await client.query<{ id: string }>(
        "INSERT INTO sync_runs (user_id, status) VALUES ($1, 'started') RETURNING id",
        [syncToken.user_id]
      );
      const syncRunId = runResult.rows[0].id;

      for (const skill of skills) {
        await client.query(
          `
            INSERT INTO synced_skills (
              user_id, sync_run_id, stable_key, skill_md_sha, identity_status, name, description, catalog_skill_id,
              github_url, is_local_only, source, is_current, last_seen_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now())
            ON CONFLICT (user_id, stable_key)
            DO UPDATE SET
              sync_run_id = EXCLUDED.sync_run_id,
              skill_md_sha = EXCLUDED.skill_md_sha,
              identity_status = EXCLUDED.identity_status,
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              catalog_skill_id = EXCLUDED.catalog_skill_id,
              github_url = EXCLUDED.github_url,
              is_local_only = EXCLUDED.is_local_only,
              source = EXCLUDED.source,
              is_current = true,
              last_seen_at = now()
          `,
          [
            syncToken.user_id,
            syncRunId,
            skill.stableKey,
            skill.skillMdSha,
            skill.identityStatus,
            skill.name,
            skill.description,
            skill.catalogSkillId,
            skill.githubUrl,
            skill.isLocalOnly,
            skill.source
          ]
        );
      }

      if (skills.length > 0) {
        await client.query(
          `
            UPDATE synced_skills
            SET is_current = false
            WHERE user_id = $1
              AND stable_key <> ALL($2::text[])
          `,
          [syncToken.user_id, skills.map((skill) => skill.stableKey)]
        );
      } else {
        await client.query("UPDATE synced_skills SET is_current = false WHERE user_id = $1", [
          syncToken.user_id
        ]);
      }

      await client.query("UPDATE sync_runs SET status = 'completed', completed_at = now() WHERE id = $1", [
        syncRunId
      ]);
      await client.query("UPDATE sync_tokens SET used_at = now() WHERE id = $1", [syncToken.id]);
      await client.query("COMMIT");

      return jsonResponse(req, {
        syncRunId,
        syncedSkillCount: skills.length
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof Response) {
        return errorResponse(req, error.status, await error.text());
      }
      return errorResponse(req, 500, "Sync upload failed");
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 400, "Invalid sync upload payload");
  }
};

export const config: Config = {
  path: "/api/portal/sync-upload"
};
