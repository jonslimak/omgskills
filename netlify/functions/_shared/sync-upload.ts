import type { Pool, PoolClient } from "pg";
import { hashToken } from "./crypto.js";
import {
  DeviceAuthError,
  deviceCredentialFromRequest,
  requireDeviceToken,
  rollback,
  touchDeviceAfterSuccessfulUse
} from "./device-auth.js";
import { writeSyncInventory } from "./sync-inventory.js";
import type { SyncSkill } from "./sync-skill.js";
import { requireString } from "./validation.js";
import { inventoryRevisionState, parseReconciliationFields, type ReconciliationInput } from "./inventory-reconciliation.js";
import { lockLegacyInventorySchema } from "./legacy-inventory-schema.js";

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
  let token: string;
  try {
    token = requireString(body.token, "token", 500);
  } catch {
    throw new DeviceAuthError();
  }
  return { kind: "legacy", token };
}

export async function performSyncUpload(
  pool: Pool,
  authentication: UploadAuthentication,
  skills: SyncSkill[],
  now = new Date(),
  reportVersion: 1 | 2 | 3 = 1,
  reconciliation?: ReconciliationInput
) {
  if (reportVersion !== 1 && authentication.kind !== "device") {
    throw new Response("Presence reports require device authorization", { status: 400 });
  }
  if (reportVersion === 3) reconciliation = parseReconciliationFields(reconciliation ?? {});
  else if (reconciliation !== undefined) throw new Response("Coverage requires reportVersion 3", { status: 400 });
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new Response("Database is not available", { status: 503 });
  }
  try {
    await client.query("BEGIN");
    await lockLegacyInventorySchema(client);
    let userId: string;
    let deviceId: string | null = null;
    let legacyTokenId: string | null = null;
    let deviceRevisionsAvailable = false;

    if (authentication.kind === "device") {
      const device = await requireDeviceToken(authentication.request, client, "sync:write", now);
      userId = device.userId;
      deviceId = device.deviceId;
      const schema = await client.query<{ available: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_attribute
         WHERE attrelid = 'device_tokens'::regclass AND attname = 'inventory_revision'
           AND attnum > 0 AND NOT attisdropped) AS available`
      );
      deviceRevisionsAvailable = schema.rows[0].available;
      if (!deviceRevisionsAvailable && reportVersion !== 1) {
        throw new Response("Per-Mac inventory schema is not available", { status: 503 });
      }
      if (deviceRevisionsAvailable) {
        const state = await inventoryRevisionState(client, userId, deviceId);
        if ((state.protocol === 3 && reportVersion !== 3)
          || (reportVersion === 3 && reconciliation!.baseRevision !== state.revision)) {
          throw new Response("Inventory revision changed; take a fresh scan", { status: 409 });
        }
      }
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

    const { syncRunId, missingSkillCount } = await writeSyncInventory(client, userId, skills, {
      deviceId: reportVersion !== 1 ? deviceId! : undefined,
      now, roots: reconciliation?.roots
    });
    if (deviceId) {
      if (deviceRevisionsAvailable) {
        await client.query(
          `UPDATE device_tokens SET inventory_revision = $2, inventory_protocol = GREATEST(inventory_protocol, $3)
           ${reportVersion === 3 ? ", inventory_checked_at = GREATEST(inventory_checked_at, $5::timestamptz)" : ""}
           WHERE id = $1 AND user_id = $4`, [deviceId, syncRunId, reportVersion, userId, ...(reportVersion === 3 ? [now] : [])]
        );
      }
      await touchDeviceAfterSuccessfulUse(client, deviceId, now);
    } else if (legacyTokenId) {
      await client.query("UPDATE sync_tokens SET used_at = $2 WHERE id = $1", [legacyTokenId, now]);
    }
    await client.query("COMMIT");
    if (reportVersion === 3) return {
      syncRunId, revision: syncRunId, syncedSkillCount: skills.length, missingSkillCount,
      reportVersion: 3 as const, mode: "reconciled" as const, deviceId,
      completedAt: now.toISOString(), roots: reconciliation!.roots,
      complete: reconciliation!.roots.every(root => root.state === "complete")
    };
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
