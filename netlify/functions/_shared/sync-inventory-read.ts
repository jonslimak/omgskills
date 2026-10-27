import type { Pool } from "pg";
import { listUserDevices } from "./device-auth.js";
import { installationFolderFromKey } from "./sync-skill.js";
import type { RootCoverage } from "./inventory-reconciliation.js";
import { readLegacySyncInventory } from "./sync-inventory.js";

export function inventoryReadVersion(req: Request, allowReconciliation = false): 1 | 2 | 3 {
  const url = new URL(req.url);
  const versions = url.searchParams.getAll("version");
  if (!versions.length || (versions.length === 1 && versions[0] === "1")) return 1;
  if (allowReconciliation && versions.length === 1 && versions[0] === "3" && url.search === "?version=3") return 3;
  if (versions.length !== 1 || versions[0] !== "2") {
    throw new Response("Unsupported inventory version", { status: 400 });
  }
  return 2;
}

export async function readSyncInventory(pool: Pool, userId: string, version: 1 | 2 | 3, now = new Date()) {
  if (version === 1) {
    const { skills } = await readLegacySyncInventory(pool, userId);
    return { skills };
  }
  const result = await pool.query(
    `SELECT id, stable_key AS "stableKey", skill_md_sha AS "skillMdSha",
       identity_status AS "identityStatus", name, description,
       catalog_skill_id AS "catalogSkillId", github_url AS "githubUrl",
       is_local_only AS "isLocalOnly", source, is_current AS "isCurrent",
       last_seen_at AS "lastSeenAt"
       , device_id AS "deviceId", git_relative_path AS "gitRelativePath", catalog_skill_id_hint AS "catalogSkillIdHint"
     FROM synced_skills skill
     WHERE user_id = $1 ${version === 3 ? "" : "AND is_current = true"}
       -- A disconnected Mac's rows stay for a same-account reconnect, but are hidden.
       AND NOT EXISTS (SELECT 1 FROM device_tokens device
         WHERE device.id = skill.device_id AND device.revoked_at IS NOT NULL)
     ORDER BY lower(name), source, id`,
    [userId]
  );

  const skills = result.rows.map(({ stableKey, ...row }) => ({
    ...row,
    installationFolder: installationFolderFromKey(stableKey, row.source),
    // Historical uploads accepted arbitrary URLs. Do not repeat credentials.
    githubUrl: safeRepositoryUrl(row.githubUrl)
  }));
  const devices = await listUserDevices(pool, userId, now);
  const reports = await pool.query<{ deviceId: string; lastReportedAt: Date | null; scanCoverage?: RootCoverage[] | null }>(
    version === 3
      ? `SELECT DISTINCT ON (device_id) device_id AS "deviceId", completed_at AS "lastReportedAt",
           scan_coverage AS "scanCoverage"
         FROM sync_runs WHERE user_id = $1 AND device_id IS NOT NULL AND status = 'completed'
         ORDER BY device_id, completed_at DESC NULLS LAST, started_at DESC, id DESC`
      : `SELECT device_id AS "deviceId", max(completed_at) AS "lastReportedAt"
     FROM sync_runs WHERE user_id = $1 AND device_id IS NOT NULL AND status = 'completed'
     GROUP BY device_id`,
    [userId]
  );
  const lastReports = new Map(reports.rows.map((row) => [row.deviceId, row]));
  const checks = version === 3 ? await pool.query<{ id: string; checkedAt: Date | null }>(
    'SELECT id, inventory_checked_at AS "checkedAt" FROM device_tokens WHERE user_id=$1', [userId]
  ) : null;
  const lastChecks = new Map(checks?.rows.map(row => [row.id, row.checkedAt]));
  return {
    inventoryVersion: version,
    skills,
    devices: devices.map((device) => ({
      id: device.id,
      deviceName: device.deviceName,
      status: device.status,
      lastReportedAt: lastReports.get(device.id)?.lastReportedAt ?? null,
      ...(version === 3 ? { scanCoverage: lastReports.get(device.id)?.scanCoverage ?? null,
        lastCheckedAt: lastChecks.get(device.id) ?? null } : {})
    }))
  };
}

function safeRepositoryUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
      || !/^\/[a-z0-9-]+\/[a-z0-9_.-]+\/?$/i.test(url.pathname)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
