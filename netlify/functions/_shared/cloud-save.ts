import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { appendSkillRelease } from "./group-storage.js";
import { cloudBlobKey, type CloudObjectStore } from "./cloud-store.js";
import {
  BROKER_SKILL_PACKAGE_LIMITS,
  gitObjectSha,
  SkillPackageValidationError,
  validateSkillManifest,
  type SkillManifestEntry,
  type SkillPackage,
  type SkillPackageValidationLimits
} from "./skill-package.js";

// Cloud save keeps a versioned copy of each skill a user wrote or changed. A saved
// skill is a 'cloud' skill source; each version is an append-only skill release
// whose files are listed in cloud_release_files and stored by blob hash. Cloud
// releases have no git commit; commit_sha is a random id, so saving earlier
// content again records a new version instead of reviving the old one.

type Database = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

// Netlify buffers request bodies up to 6 MB, so one file must fit in one upload.
export const CLOUD_SAVE_LIMITS: SkillPackageValidationLimits & { maximumUserBytes: number } = {
  ...BROKER_SKILL_PACKAGE_LIMITS,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumUserBytes: 1024 * 1024 * 1024
};
const MAX_EXCLUDED_SKILLS = 5000;

export type CloudSaveErrorCode =
  | "unavailable"
  | "disabled"
  | "excluded"
  | "invalid_skill_key"
  | "invalid_request"
  | "invalid_package"
  | "blob_mismatch"
  | "file_too_large"
  | "quota_exceeded"
  | "not_found";

export class CloudSaveError extends Error {
  constructor(readonly code: CloudSaveErrorCode, message: string, readonly detail?: string) {
    super(message);
    this.name = "CloudSaveError";
  }
}

const statusByCode: Record<CloudSaveErrorCode, number> = {
  unavailable: 503,
  disabled: 403,
  excluded: 403,
  invalid_skill_key: 400,
  invalid_request: 400,
  invalid_package: 422,
  blob_mismatch: 422,
  file_too_large: 413,
  quota_exceeded: 413,
  not_found: 404
};

export function cloudSaveErrorStatus(error: CloudSaveError): number {
  return statusByCode[error.code];
}

export function isCloudSaveAvailable(env: (key: string) => string | undefined): boolean {
  return env("CLOUD_SAVE_ENABLED") === "true";
}

/**
 * A skill's identity across agents and Macs: its folder name, NFC and lower case. Names with
 * surrounding spaces, slashes, or control, format or line-separator characters are refused
 * rather than trimmed, so the Mac, the web and the database always agree on the key.
 */
export function normalizeSkillKey(value: unknown): string {
  if (typeof value !== "string") throw new CloudSaveError("invalid_skill_key", "Invalid skill key");
  const key = value.normalize("NFC").toLowerCase();
  if (
    !key
    || key.length > 200
    || key !== key.trim()
    || key.startsWith(".")
    || /[/\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(key)
  ) {
    throw new CloudSaveError("invalid_skill_key", "Invalid skill key");
  }
  return key;
}

function requireBlobSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new CloudSaveError("invalid_request", "Invalid file hash");
  }
  return value.toLowerCase();
}

export type CloudSaveSettings = { enabled: boolean; excludedSkillKeys: string[] };

export type CloudSavedVersion = {
  id: string;
  treeSha: string;
  skillMdSha: string;
  fileCount: number;
  totalBytes: number;
  deviceId: string | null;
  savedAt: string;
};

export type CloudSavedSkill = {
  key: string;
  currentVersion: CloudSavedVersion;
  versionCount: number;
  deletedLocallyAt: string | null;
};

export type CloudSaveState = {
  settings: CloudSaveSettings;
  usage: { bytes: number; limitBytes: number };
  skills: CloudSavedSkill[];
};

export async function readCloudSaveSettings(db: Database, userId: string): Promise<CloudSaveSettings> {
  const result = await db.query<CloudSaveSettings>(
    `SELECT enabled, excluded_skill_keys AS "excludedSkillKeys" FROM cloud_save_settings WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] ?? { enabled: false, excludedSkillKeys: [] };
}

async function usedBytes(db: Database, userId: string): Promise<number> {
  const result = await db.query<{ bytes: string }>(
    "SELECT COALESCE(sum(byte_size), 0)::text AS bytes FROM cloud_blobs WHERE user_id = $1",
    [userId]
  );
  return Number(result.rows[0].bytes);
}

// Times are ISO 8601 in UTC with milliseconds, which every browser and the Mac parse.
const versionColumns = `
  release.id,
  release.tree_sha AS "treeSha",
  release.skill_md_sha AS "skillMdSha",
  cloud.file_count AS "fileCount",
  cloud.total_bytes AS "totalBytes",
  cloud.device_id AS "deviceId",
  to_char(release.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "savedAt"
`;

export async function readCloudSave(db: Database, userId: string): Promise<CloudSaveState> {
  const [settings, bytes, skills] = await Promise.all([
    readCloudSaveSettings(db, userId),
    usedBytes(db, userId),
    db.query<CloudSavedVersion & { key: string; versionCount: number; deletedLocallyAt: string | null }>(
      `
        SELECT
          saved.skill_key AS key,
          to_char(saved.deleted_locally_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "deletedLocallyAt",
          (SELECT count(*)::int FROM skill_releases WHERE source_id = saved.source_id) AS "versionCount",
          ${versionColumns}
        FROM cloud_saved_skills saved
        JOIN skill_releases release ON release.id = saved.current_release_id
        JOIN cloud_releases cloud ON cloud.release_id = release.id
        WHERE saved.user_id = $1
        ORDER BY saved.skill_key
      `,
      [userId]
    )
  ]);
  return {
    settings,
    usage: { bytes, limitBytes: CLOUD_SAVE_LIMITS.maximumUserBytes },
    skills: skills.rows.map(({ key, versionCount, deletedLocallyAt, ...version }) => ({
      key,
      versionCount,
      deletedLocallyAt,
      currentVersion: version
    }))
  };
}

export function parseCloudSaveSettingsUpdate(body: Record<string, unknown>): Partial<CloudSaveSettings> {
  const update: Partial<CloudSaveSettings> = {};
  if (Object.hasOwn(body, "enabled")) {
    if (typeof body.enabled !== "boolean") throw new CloudSaveError("invalid_request", "enabled must be true or false");
    update.enabled = body.enabled;
  }
  if (Object.hasOwn(body, "excludedSkillKeys")) {
    if (!Array.isArray(body.excludedSkillKeys) || body.excludedSkillKeys.length > MAX_EXCLUDED_SKILLS) {
      throw new CloudSaveError("invalid_request", "excludedSkillKeys must be a list of skill keys");
    }
    update.excludedSkillKeys = [...new Set(body.excludedSkillKeys.map(normalizeSkillKey))].sort();
  }
  if (update.enabled === undefined && update.excludedSkillKeys === undefined) {
    throw new CloudSaveError("invalid_request", "Nothing to update");
  }
  return update;
}

export async function updateCloudSaveSettings(
  db: Database,
  userId: string,
  update: Partial<CloudSaveSettings>
): Promise<CloudSaveSettings> {
  const result = await db.query<CloudSaveSettings>(
    `
      INSERT INTO cloud_save_settings (user_id, enabled, excluded_skill_keys)
      VALUES ($1, COALESCE($2, false), COALESCE($3, ARRAY[]::text[]))
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = COALESCE($2, cloud_save_settings.enabled),
        excluded_skill_keys = COALESCE($3, cloud_save_settings.excluded_skill_keys),
        updated_at = now()
      RETURNING enabled, excluded_skill_keys AS "excludedSkillKeys"
    `,
    [userId, update.enabled ?? null, update.excludedSkillKeys ?? null]
  );
  return result.rows[0];
}

async function requireSavingEnabled(db: Database, userId: string, skillKey?: string): Promise<void> {
  const settings = await readCloudSaveSettings(db, userId);
  if (!settings.enabled) throw new CloudSaveError("disabled", "Cloud save is turned off");
  if (skillKey && settings.excludedSkillKeys.includes(skillKey)) {
    throw new CloudSaveError("excluded", "This skill is not chosen for cloud save");
  }
}

/** Stores one file's contents, named by its git blob hash. Saving the same file again is a no-op. */
export async function storeCloudBlob(
  pool: Pool,
  store: CloudObjectStore,
  input: { userId: string; blobSha: unknown; data: Uint8Array }
): Promise<{ blobSha: string; stored: boolean }> {
  const blobSha = requireBlobSha(input.blobSha);
  if (input.data.byteLength > CLOUD_SAVE_LIMITS.maximumFileBytes) {
    throw new CloudSaveError("file_too_large", "File is too large to save");
  }
  if (gitObjectSha("blob", input.data) !== blobSha) {
    throw new CloudSaveError("blob_mismatch", "File contents do not match their hash");
  }
  return withUploadLock(pool, input.userId, async (client) => {
    const existing = await client.query(
      "SELECT 1 FROM cloud_blobs WHERE user_id = $1 AND blob_sha = $2",
      [input.userId, blobSha]
    );
    if (existing.rowCount) return { blobSha, stored: false };
    if (await usedBytes(client, input.userId) + input.data.byteLength > CLOUD_SAVE_LIMITS.maximumUserBytes) {
      throw new CloudSaveError("quota_exceeded", "Cloud storage is full");
    }
    await store.put(cloudBlobKey(input.userId, blobSha), input.data);
    await client.query(
      "INSERT INTO cloud_blobs (user_id, blob_sha, byte_size) VALUES ($1, $2, $3)",
      [input.userId, blobSha, input.data.byteLength]
    );
    return { blobSha, stored: true };
  });
}

/**
 * Runs one upload while holding the user's cloud save settings row, so uploads from
 * several requests take turns: the storage limit is checked and the file recorded
 * before the next upload checks it. Cloud save must be on; the lock confirms it.
 */
async function withUploadLock<T>(pool: Pool, userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settings = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM cloud_save_settings WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (!settings.rows[0]?.enabled) throw new CloudSaveError("disabled", "Cloud save is turned off");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function parseCloudManifest(body: Record<string, unknown>): SkillManifestEntry[] {
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new CloudSaveError("invalid_request", "files must list the skill's files");
  }
  return body.files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new CloudSaveError("invalid_request", "Each file needs path, mode, blobSha and byteSize");
    }
    const { path, mode, blobSha, byteSize } = file as Record<string, unknown>;
    if (typeof path !== "string" || typeof mode !== "string" || typeof byteSize !== "number") {
      throw new CloudSaveError("invalid_request", "Each file needs path, mode, blobSha and byteSize");
    }
    return { path, mode, blobSha: requireBlobSha(blobSha), byteSize };
  });
}

export type SaveCloudVersionResult =
  | { status: "missing_files"; missing: string[] }
  | { status: "saved"; created: boolean; skill: { key: string; currentVersion: CloudSavedVersion } };

async function readVersion(db: Database, releaseId: string): Promise<CloudSavedVersion> {
  const result = await db.query<CloudSavedVersion>(
    `
      SELECT ${versionColumns}
      FROM skill_releases release
      JOIN cloud_releases cloud ON cloud.release_id = release.id
      WHERE release.id = $1
    `,
    [releaseId]
  );
  return result.rows[0];
}

/**
 * Records a version of a skill from its file list. Files must already be stored;
 * if any are missing, nothing is recorded and their hashes are returned so the
 * device can upload them and try again.
 */
export async function saveCloudVersion(
  pool: Pool,
  input: {
    userId: string;
    deviceId: string | null;
    skillKey: unknown;
    files: SkillManifestEntry[];
    expectedTreeSha?: unknown;
  }
): Promise<SaveCloudVersionResult> {
  const skillKey = normalizeSkillKey(input.skillKey);
  await requireSavingEnabled(pool, input.userId, skillKey);
  let manifest;
  try {
    manifest = validateSkillManifest(input.files, CLOUD_SAVE_LIMITS);
  } catch (error) {
    if (error instanceof SkillPackageValidationError) {
      throw new CloudSaveError("invalid_package", "The skill's files are not a valid skill", error.message);
    }
    throw error;
  }
  if (input.expectedTreeSha !== undefined && requireBlobSha(input.expectedTreeSha) !== manifest.treeSha) {
    throw new CloudSaveError("invalid_package", "The skill's tree hash does not match its files");
  }

  const hashes = [...new Set(input.files.map((file) => file.blobSha))];
  const stored = await pool.query<{ blob_sha: string; byte_size: number }>(
    "SELECT blob_sha, byte_size FROM cloud_blobs WHERE user_id = $1 AND blob_sha = ANY($2::text[])",
    [input.userId, hashes]
  );
  const sizes = new Map(stored.rows.map((row) => [row.blob_sha, row.byte_size]));
  const missing = hashes.filter((hash) => !sizes.has(hash));
  if (missing.length) return { status: "missing_files", missing };
  const wrongSize = input.files.find((file) => sizes.get(file.blobSha) !== file.byteSize);
  if (wrongSize) {
    throw new CloudSaveError("invalid_package", "A file's size does not match its stored contents", wrongSize.path);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Checked again under a lock: turning cloud save off or leaving the skill out waits for
    // this save to finish, and a save that starts after the change is refused.
    const settings = await client.query<{ enabled: boolean; excluded: string[] }>(
      "SELECT enabled, excluded_skill_keys AS excluded FROM cloud_save_settings WHERE user_id = $1 FOR SHARE",
      [input.userId]
    );
    if (!settings.rows[0]?.enabled) throw new CloudSaveError("disabled", "Cloud save is turned off");
    if (settings.rows[0].excluded.includes(skillKey)) {
      throw new CloudSaveError("excluded", "This skill is not chosen for cloud save");
    }
    const sourceId = await lockCloudSource(client, input.userId, skillKey);
    const current = await client.query<{ releaseId: string; treeSha: string }>(
      `
        SELECT release.id AS "releaseId", release.tree_sha AS "treeSha"
        FROM cloud_saved_skills saved
        JOIN skill_releases release ON release.id = saved.current_release_id
        WHERE saved.source_id = $1
      `,
      [sourceId]
    );
    if (current.rows[0]?.treeSha === manifest.treeSha) {
      await client.query("COMMIT");
      return { status: "saved", created: false,
        skill: { key: skillKey, currentVersion: await readVersion(pool, current.rows[0].releaseId) } };
    }
    const commitSha = createHash("sha1").update(`omgskills cloud save\n${manifest.treeSha}\n${randomUUID()}`).digest("hex");
    const releaseId = await appendSkillRelease(client, {
      sourceId,
      commitSha,
      treeSha: manifest.treeSha,
      skillMdSha: manifest.skillMdSha,
      createdBy: input.userId
    });
    await client.query(
      `
        INSERT INTO cloud_releases (release_id, source_id, device_id, file_count, total_bytes)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [releaseId, sourceId, input.deviceId, manifest.fileCount, manifest.totalBytes]
    );
    await client.query(
      `
        INSERT INTO cloud_release_files (release_id, path, mode, blob_sha, byte_size)
        SELECT $1, file.path, file.mode, file.blob_sha, file.byte_size
        FROM unnest($2::text[], $3::text[], $4::text[], $5::int[])
          AS file(path, mode, blob_sha, byte_size)
      `,
      [
        releaseId,
        input.files.map((file) => file.path),
        input.files.map((file) => file.mode),
        input.files.map((file) => file.blobSha),
        input.files.map((file) => file.byteSize)
      ]
    );
    await client.query(
      `
        INSERT INTO cloud_saved_skills (source_id, user_id, skill_key, current_release_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (source_id) DO UPDATE SET
          current_release_id = EXCLUDED.current_release_id,
          deleted_locally_at = NULL,
          updated_at = now()
      `,
      [sourceId, input.userId, skillKey, releaseId]
    );
    await client.query("COMMIT");
    return { status: "saved", created: true, skill: { key: skillKey, currentVersion: await readVersion(pool, releaseId) } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockCloudSource(client: PoolClient, userId: string, skillKey: string): Promise<string> {
  await client.query(
    `
      INSERT INTO skill_sources (kind, normalized_root, owner_user_id)
      VALUES ('cloud', $2, $1)
      ON CONFLICT (owner_user_id, normalized_root) WHERE kind = 'cloud' DO NOTHING
    `,
    [userId, skillKey]
  );
  const result = await client.query<{ id: string }>(
    `
      SELECT id FROM skill_sources
      WHERE kind = 'cloud' AND owner_user_id = $1 AND normalized_root = $2 AND tombstoned_at IS NULL
      FOR UPDATE
    `,
    [userId, skillKey]
  );
  if (!result.rows[0]) throw new CloudSaveError("not_found", "Saved skill is unavailable");
  return result.rows[0].id;
}

/** Marks a saved skill as deleted (or back) on the user's Mac. Its cloud copy is kept. */
export async function markDeletedLocally(
  db: Database,
  input: { userId: string; skillKey: unknown; deleted: unknown }
): Promise<{ key: string; deletedLocallyAt: string | null }> {
  const skillKey = normalizeSkillKey(input.skillKey);
  if (typeof input.deleted !== "boolean") throw new CloudSaveError("invalid_request", "deleted must be true or false");
  const result = await db.query<{ deletedLocallyAt: string | null }>(
    `
      UPDATE cloud_saved_skills
      SET deleted_locally_at = CASE WHEN $3 THEN COALESCE(deleted_locally_at, now()) ELSE NULL END,
          updated_at = now()
      WHERE user_id = $1 AND skill_key = $2
      RETURNING to_char(deleted_locally_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "deletedLocallyAt"
    `,
    [input.userId, skillKey, input.deleted]
  );
  if (!result.rows[0]) throw new CloudSaveError("not_found", "Saved skill not found");
  return { key: skillKey, deletedLocallyAt: result.rows[0].deletedLocallyAt };
}

export async function listCloudVersions(
  db: Database,
  input: { userId: string; skillKey: unknown }
): Promise<CloudSavedVersion[]> {
  const skillKey = normalizeSkillKey(input.skillKey);
  const result = await db.query<CloudSavedVersion>(
    `
      SELECT ${versionColumns}
      FROM cloud_saved_skills saved
      JOIN skill_releases release ON release.source_id = saved.source_id
      JOIN cloud_releases cloud ON cloud.release_id = release.id
      WHERE saved.user_id = $1 AND saved.skill_key = $2
      ORDER BY release.created_at DESC, release.id
    `,
    [input.userId, skillKey]
  );
  if (!result.rows.length) throw new CloudSaveError("not_found", "Saved skill not found");
  return result.rows;
}

/** Loads one of the user's saved versions with its files, ready to stream to a device. */
export async function loadCloudVersionPackage(
  db: Database,
  store: CloudObjectStore,
  input: { userId: string; releaseId: string }
): Promise<{ sourceId: string; releaseId: string; package: SkillPackage }> {
  const release = await db.query<{ sourceId: string; commitSha: string; treeSha: string; skillMdSha: string }>(
    `
      SELECT release.source_id AS "sourceId", release.commit_sha AS "commitSha",
        release.tree_sha AS "treeSha", release.skill_md_sha AS "skillMdSha"
      FROM skill_releases release
      JOIN skill_sources source ON source.id = release.source_id
      WHERE release.id = $1 AND source.kind = 'cloud' AND source.owner_user_id = $2 AND source.tombstoned_at IS NULL
    `,
    [input.releaseId, input.userId]
  );
  const row = release.rows[0];
  if (!row) throw new CloudSaveError("not_found", "Saved version not found");
  const files = await db.query<{ path: string; mode: string; blobSha: string }>(
    `
      SELECT path, mode, blob_sha AS "blobSha"
      FROM cloud_release_files
      WHERE release_id = $1
      ORDER BY path COLLATE "C"
    `,
    [input.releaseId]
  );
  const entries = await Promise.all(files.rows.map(async (file) => ({
    ...file,
    data: await store.get(cloudBlobKey(input.userId, file.blobSha))
  })));
  return {
    sourceId: row.sourceId,
    releaseId: input.releaseId,
    package: {
      coordinates: { commitSha: row.commitSha, treeSha: row.treeSha, skillMdSha: row.skillMdSha },
      entries
    }
  };
}
