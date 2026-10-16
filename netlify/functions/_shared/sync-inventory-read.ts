import type { Pool } from "pg";
import { listUserDevices } from "./device-auth.js";
import { installationFolderFromKey } from "./sync-skill.js";

export function inventoryReadVersion(req: Request): 1 | 2 {
  const versions = new URL(req.url).searchParams.getAll("version");
  if (!versions.length) return 1;
  if (versions.length !== 1 || versions[0] !== "2") {
    throw new Response("Unsupported inventory version", { status: 400 });
  }
  return 2;
}

export async function readSyncInventory(pool: Pool, userId: string, version: 1 | 2, now = new Date()) {
  const result = await pool.query(
    `SELECT id, stable_key AS "stableKey", skill_md_sha AS "skillMdSha",
       identity_status AS "identityStatus", name, description,
       catalog_skill_id AS "catalogSkillId", github_url AS "githubUrl",
       is_local_only AS "isLocalOnly", source, is_current AS "isCurrent",
       last_seen_at AS "lastSeenAt"
       ${version === 2 ? ', device_id AS "deviceId", git_relative_path AS "gitRelativePath", catalog_skill_id_hint AS "catalogSkillIdHint"' : ""}
     FROM synced_skills
     WHERE user_id = $1 AND is_current = true ${version === 1 ? "AND device_id IS NULL" : ""}
     ORDER BY lower(name), source, id`,
    [userId]
  );
  if (version === 1) return { skills: result.rows };

  const skills = result.rows.map(({ stableKey, ...row }) => ({
    ...row,
    installationFolder: installationFolderFromKey(stableKey, row.source),
    // Historical uploads accepted arbitrary URLs. Do not repeat credentials.
    githubUrl: safeRepositoryUrl(row.githubUrl)
  }));
  const devices = await listUserDevices(pool, userId, now);
  const reports = await pool.query<{ deviceId: string; lastReportedAt: Date }>(
    `SELECT device_id AS "deviceId", max(completed_at) AS "lastReportedAt"
     FROM sync_runs WHERE user_id = $1 AND device_id IS NOT NULL AND status = 'completed'
     GROUP BY device_id`,
    [userId]
  );
  const lastReports = new Map(reports.rows.map((row) => [row.deviceId, row.lastReportedAt]));
  return {
    inventoryVersion: 2,
    skills,
    devices: devices.map((device) => ({
      id: device.id,
      deviceName: device.deviceName,
      status: device.status,
      lastReportedAt: lastReports.get(device.id) ?? null
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
