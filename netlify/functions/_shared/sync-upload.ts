import type { Pool, PoolClient } from "pg";
import { hashToken } from "./crypto.js";
import {
  deviceCredentialFromRequest,
  requireDeviceToken,
  rollback,
  touchDeviceAfterSuccessfulUse
} from "./device-auth.js";
import { writeSyncInventory } from "./sync-inventory.js";
import type { SyncSkill } from "./sync-skill.js";
import { requireString } from "./validation.js";

type UploadAuthentication =
  | { kind: "device"; request: Request }
  | { kind: "legacy"; token: string };

export function uploadAuthenticationFromRequest(
  req: Request,
  body: Record<string, unknown>
): UploadAuthentication {
  if (req.headers.has("authorization")) {
    deviceCredentialFromRequest(req);
    if (body.token !== undefined) {
      throw new Response("token must not be sent with device authorization", { status: 400 });
    }
    return { kind: "device", request: req };
  }
  return { kind: "legacy", token: requireString(body.token, "token", 500) };
}

export async function performSyncUpload(
  pool: Pool,
  authentication: UploadAuthentication,
  skills: SyncSkill[],
  now = new Date(),
  reportVersion: 1 | 2 = 1
) {
  if (reportVersion === 2 && authentication.kind !== "device") {
    throw new Response("Presence reports require device authorization", { status: 400 });
  }
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new Response("Database is not available", { status: 503 });
  }
  try {
    await client.query("BEGIN");
    let userId: string;
    let deviceId: string | null = null;
    let legacyTokenId: string | null = null;

    if (authentication.kind === "device") {
      const device = await requireDeviceToken(authentication.request, client, "sync:write", now);
      userId = device.userId;
      deviceId = device.deviceId;
    } else {
      const tokenResult = await client.query<{ id: string; user_id: string }>(
        `
          SELECT id, user_id
          FROM sync_tokens
          WHERE token_hash = $1
            AND purpose = 'legacy_upload'
            AND used_at IS NULL
            AND expires_at > $2
          FOR UPDATE
        `,
        [hashToken(authentication.token), now]
      );
      const token = tokenResult.rows[0];
      if (!token) {
        throw new Response("Sync token is invalid or expired", { status: 401 });
      }
      userId = token.user_id;
      legacyTokenId = token.id;
    }

    const syncRunId = await writeSyncInventory(client, userId, skills, {
      deviceId: reportVersion === 2 ? deviceId! : undefined,
      now
    });
    if (deviceId) {
      await touchDeviceAfterSuccessfulUse(client, deviceId, now);
    } else if (legacyTokenId) {
      await client.query("UPDATE sync_tokens SET used_at = $2 WHERE id = $1", [legacyTokenId, now]);
    }
    await client.query("COMMIT");
    return reportVersion === 2
      ? { syncRunId, syncedSkillCount: skills.length, reportVersion: 2 as const,
          mode: "presence" as const, deviceId, completedAt: now.toISOString() }
      : { syncRunId, syncedSkillCount: skills.length };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}
