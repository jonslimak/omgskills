import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { appendSkillRelease } from "./group-storage.js";
import { cloudBlobKey, type CloudObjectStore } from "./cloud-store.js";
import { combineLabels, pathLabels, scanFileContents, type SecretFinding, type SkillLabel } from "./skill-scan.js";
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
  | "needs_review"
  | "not_found";

export type HeldFile = { path: string; blobSha: string; findings: SecretFinding[] };

export class CloudSaveError extends Error {
  constructor(
    readonly code: CloudSaveErrorCode,
    message: string,
    readonly detail?: string,
    readonly heldFiles?: HeldFile[] | SecretFinding[]
  ) {
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
  needs_review: 422,
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
  labels: SkillLabel[];
};

export type CloudSavedSkill = {
  key: string;
  currentVersion: CloudSavedVersion;
  versionCount: number;
  deletedLocallyAt: string | null;
};

export type CloudSkillReview = {
  key: string;
  /** The Mac whose copy is waiting. */
  deviceId: string | null;
  files: { path: string; findings: SecretFinding[] }[];
  confirmed: boolean;
  updatedAt: string;
};

export type CloudSaveState = {
  settings: CloudSaveSettings;
  usage: { bytes: number; limitBytes: number };
  skills: CloudSavedSkill[];
  needsReview: CloudSkillReview[];
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
  to_char(release.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "savedAt",
  cloud.labels
`;

async function readReviews(db: Database, userId: string): Promise<CloudSkillReview[]> {
  const result = await db.query<{ key: string; deviceId: string | null; files: HeldFile[]; confirmed: boolean; updatedAt: string }>(
    `
      SELECT
        review.skill_key AS key,
        review.device_id AS "deviceId",
        review.files,
        to_char(review.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
        NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(review.files) AS file
          LEFT JOIN cloud_secret_holds hold
            ON hold.user_id = review.user_id AND hold.blob_sha = file->>'blobSha'
          WHERE hold.confirmed_at IS NULL
        ) AS confirmed
      FROM cloud_skill_reviews review
      WHERE review.user_id = $1
      ORDER BY review.skill_key
    `,
    [userId]
  );
  return result.rows.map((row) => ({
    key: row.key,
    deviceId: row.deviceId,
    files: row.files.map(({ path, findings }) => ({ path, findings })),
    confirmed: row.confirmed,
    updatedAt: row.updatedAt
  }));
}

export async function readCloudSave(db: Database, userId: string): Promise<CloudSaveState> {
  const [settings, bytes, skills, needsReview] = await Promise.all([
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
    ),
    readReviews(db, userId)
  ]);
  return {
    settings,
    needsReview,
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

/**
 * Stores one file's contents, named by its git blob hash. Saving the same file again is a no-op.
 * A file that looks like it contains a key or password is held back, unless the user has
 * confirmed it (here with confirmSecrets, or earlier through its skill's review).
 */
export async function storeCloudBlob(
  pool: Pool,
  store: CloudObjectStore,
  input: { userId: string; deviceId?: string | null; blobSha: unknown; data: Uint8Array; confirmSecrets?: boolean }
): Promise<{ blobSha: string; stored: boolean; labels: SkillLabel[] }> {
  const blobSha = requireBlobSha(input.blobSha);
  if (input.data.byteLength > CLOUD_SAVE_LIMITS.maximumFileBytes) {
    throw new CloudSaveError("file_too_large", "File is too large to save");
  }
  if (gitObjectSha("blob", input.data) !== blobSha) {
    throw new CloudSaveError("blob_mismatch", "File contents do not match their hash");
  }
  // Checked again under the upload lock; this keeps a turned-off account from recording holds.
  await requireSavingEnabled(pool, input.userId);
  const existing = await pool.query(
    "SELECT 1 FROM cloud_blobs WHERE user_id = $1 AND blob_sha = $2",
    [input.userId, blobSha]
  );
  if (existing.rowCount) return { blobSha, stored: false, labels: [] };
  const scan = scanFileContents(input.data);
  const labels: SkillLabel[] = [...scan.labels];
  if (scan.secrets.length) {
    // Recorded outside the upload's transaction: a held file's review must outlive the refusal.
    const hold = await pool.query<{ confirmed: boolean }>(
      `
        INSERT INTO cloud_secret_holds (user_id, blob_sha, findings, confirmed_at, confirmed_by_device_id)
        VALUES ($1, $2, $3::jsonb, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $5::uuid END)
        ON CONFLICT (user_id, blob_sha) DO UPDATE SET
          findings = EXCLUDED.findings,
          confirmed_at = COALESCE(cloud_secret_holds.confirmed_at, EXCLUDED.confirmed_at),
          confirmed_by_device_id = COALESCE(cloud_secret_holds.confirmed_by_device_id, EXCLUDED.confirmed_by_device_id)
        RETURNING confirmed_at IS NOT NULL AS confirmed
      `,
      [input.userId, blobSha, JSON.stringify(scan.secrets), input.confirmSecrets === true, input.deviceId ?? null]
    );
    if (!hold.rows[0].confirmed) {
      throw new CloudSaveError("needs_review", "This file looks like it contains a key or password", undefined, scan.secrets);
    }
    labels.push("confirmed_secret");
  }
  const blobLabels = combineLabels([labels]);
  return withUploadLock(pool, input.userId, async (client) => {
    const stored = await client.query(
      "SELECT 1 FROM cloud_blobs WHERE user_id = $1 AND blob_sha = $2",
      [input.userId, blobSha]
    );
    if (stored.rowCount) return { blobSha, stored: false, labels: [] };
    if (await usedBytes(client, input.userId) + input.data.byteLength > CLOUD_SAVE_LIMITS.maximumUserBytes) {
      throw new CloudSaveError("quota_exceeded", "Cloud storage is full");
    }
    await queueCleanupFirst(pool, input.userId, [blobSha]);
    await store.put(cloudBlobKey(input.userId, blobSha), input.data);
    await client.query(
      "INSERT INTO cloud_blobs (user_id, blob_sha, byte_size, labels) VALUES ($1, $2, $3, $4)",
      [input.userId, blobSha, input.data.byteLength, blobLabels]
    );
    // Stored again after a delete: it must not be removed by the pending clean-up.
    await client.query("DELETE FROM cloud_purge_queue WHERE user_id = $1 AND blob_sha = $2", [input.userId, blobSha]);
    return { blobSha, stored: true, labels: blobLabels };
  });
}

export const MAX_BLOB_BATCH_FILES = 200;

export type CloudBlobBatchResult =
  | { blobSha: string; status: "stored" | "exists"; labels: SkillLabel[] }
  | { blobSha: string; status: "needs_review"; findings: SecretFinding[] };

/** Reads a batch upload: up to MAX_BLOB_BATCH_FILES files, base64, together no larger than one file upload. */
export function parseCloudBlobBatch(body: Record<string, unknown>): { blobSha: string; data: Uint8Array }[] {
  const files = body.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_BLOB_BATCH_FILES) {
    throw new CloudSaveError("invalid_request", `Send 1 to ${MAX_BLOB_BATCH_FILES} files`);
  }
  let total = 0;
  return files.map((file) => {
    if (typeof file !== "object" || file === null || typeof file.data !== "string") {
      throw new CloudSaveError("invalid_request", "Each file needs blobSha and base64 data");
    }
    const data = new Uint8Array(Buffer.from(file.data, "base64"));
    total += data.byteLength;
    if (total > CLOUD_SAVE_LIMITS.maximumFileBytes) throw new CloudSaveError("file_too_large", "Batch is too large to save");
    return { blobSha: requireBlobSha(file.blobSha), data };
  });
}

/**
 * Stores several files in one request, each checked as storeCloudBlob checks one, with one
 * lookup, one storage check and parallel uploads so a big skill fits in one request's time.
 * A held file is reported in its result and doesn't stop the others; anything else stops the batch.
 */
export async function storeCloudBlobs(
  pool: Pool,
  store: CloudObjectStore,
  input: { userId: string; deviceId?: string | null; files: { blobSha: string; data: Uint8Array }[] }
): Promise<CloudBlobBatchResult[]> {
  const files = new Map<string, Uint8Array>();
  for (const file of input.files) {
    const blobSha = requireBlobSha(file.blobSha);
    if (file.data.byteLength > CLOUD_SAVE_LIMITS.maximumFileBytes) {
      throw new CloudSaveError("file_too_large", "File is too large to save");
    }
    if (gitObjectSha("blob", file.data) !== blobSha) {
      throw new CloudSaveError("blob_mismatch", "File contents do not match their hash");
    }
    files.set(blobSha, file.data);
  }
  await requireSavingEnabled(pool, input.userId);
  const storedAlready = async (db: Database) => new Set((await db.query<{ blob_sha: string }>(
    "SELECT blob_sha FROM cloud_blobs WHERE user_id = $1 AND blob_sha = ANY($2::text[])",
    [input.userId, [...files.keys()]]
  )).rows.map((row) => row.blob_sha));

  const existing = await storedAlready(pool);
  const results = new Map<string, CloudBlobBatchResult>();
  const pending: { blobSha: string; data: Uint8Array; labels: SkillLabel[] }[] = [];
  for (const [blobSha, data] of files) {
    if (existing.has(blobSha)) { results.set(blobSha, { blobSha, status: "exists", labels: [] }); continue; }
    const scan = scanFileContents(data);
    const labels: SkillLabel[] = [...scan.labels];
    if (scan.secrets.length) {
      // Recorded outside the upload's transaction: a held file's review must outlive the refusal.
      const hold = await pool.query<{ confirmed: boolean }>(
        `
          INSERT INTO cloud_secret_holds (user_id, blob_sha, findings)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (user_id, blob_sha) DO UPDATE SET findings = EXCLUDED.findings
          RETURNING confirmed_at IS NOT NULL AS confirmed
        `,
        [input.userId, blobSha, JSON.stringify(scan.secrets)]
      );
      if (!hold.rows[0].confirmed) {
        results.set(blobSha, { blobSha, status: "needs_review", findings: scan.secrets });
        continue;
      }
      labels.push("confirmed_secret");
    }
    pending.push({ blobSha, data, labels: combineLabels([labels]) });
  }

  if (pending.length) {
    await withUploadLock(pool, input.userId, async (client) => {
      const stored = await storedAlready(client);
      const fresh = pending.filter((file) => !stored.has(file.blobSha));
      for (const file of pending) if (stored.has(file.blobSha)) results.set(file.blobSha, { blobSha: file.blobSha, status: "exists", labels: [] });
      const bytes = fresh.reduce((sum, file) => sum + file.data.byteLength, 0);
      if (await usedBytes(client, input.userId) + bytes > CLOUD_SAVE_LIMITS.maximumUserBytes) {
        throw new CloudSaveError("quota_exceeded", "Cloud storage is full");
      }
      await queueCleanupFirst(pool, input.userId, fresh.map((file) => file.blobSha));
      for (let index = 0; index < fresh.length; index += BLOB_UPLOAD_CONCURRENCY) {
        await Promise.all(fresh.slice(index, index + BLOB_UPLOAD_CONCURRENCY)
          .map((file) => store.put(cloudBlobKey(input.userId, file.blobSha), file.data)));
      }
      await client.query(
        `
          INSERT INTO cloud_blobs (user_id, blob_sha, byte_size, labels)
          SELECT $1, file.blob_sha, file.byte_size, ARRAY(SELECT jsonb_array_elements_text(file.labels))
          FROM jsonb_to_recordset($2::jsonb) AS file(blob_sha text, byte_size integer, labels jsonb)
        `,
        [input.userId, JSON.stringify(fresh.map((file) => ({
          blob_sha: file.blobSha, byte_size: file.data.byteLength, labels: file.labels
        })))]
      );
      for (const file of fresh) results.set(file.blobSha, { blobSha: file.blobSha, status: "stored", labels: file.labels });
      // Stored again after a delete: they must not be removed by the pending clean-up.
      await client.query("DELETE FROM cloud_purge_queue WHERE user_id = $1 AND blob_sha = ANY($2::text[])",
        [input.userId, fresh.map((file) => file.blobSha)]);
    });
  }
  return input.files.map((file) => results.get(requireBlobSha(file.blobSha))!);
}

const BLOB_UPLOAD_CONCURRENCY = 16;

/**
 * Queues files about to be uploaded for clean-up, on a connection of its own so the entry
 * outlives the upload's transaction: if the upload fails or is cut off, files already sent
 * are removed by the next read. A finished upload takes them off the queue again.
 * Called under the upload lock, which the clean-up also takes, so it can't run in between.
 */
async function queueCleanupFirst(pool: Pool, userId: string, blobShas: string[]): Promise<void> {
  if (!blobShas.length) return;
  await pool.query(
    "INSERT INTO cloud_purge_queue (user_id, blob_sha) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
    [userId, blobShas]
  );
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
  const stored = await pool.query<{ blob_sha: string; byte_size: number; labels: string[] }>(
    "SELECT blob_sha, byte_size, labels FROM cloud_blobs WHERE user_id = $1 AND blob_sha = ANY($2::text[])",
    [input.userId, hashes]
  );
  const sizes = new Map(stored.rows.map((row) => [row.blob_sha, row.byte_size]));
  const missing = hashes.filter((hash) => !sizes.has(hash));
  if (missing.length) {
    const held = await heldFiles(pool, input.userId, input.files.filter((file) => missing.includes(file.blobSha)));
    if (held.length) {
      await pool.query(
        `
          INSERT INTO cloud_skill_reviews (user_id, skill_key, device_id, files)
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (user_id, skill_key) DO UPDATE SET
            device_id = EXCLUDED.device_id, files = EXCLUDED.files, updated_at = now()
        `,
        [input.userId, skillKey, input.deviceId, JSON.stringify(held)]
      );
      throw new CloudSaveError("needs_review", "This skill has files that look like they contain a key or password", undefined, held);
    }
    return { status: "missing_files", missing };
  }
  const wrongSize = input.files.find((file) => sizes.get(file.blobSha) !== file.byteSize);
  if (wrongSize) {
    throw new CloudSaveError("invalid_package", "A file's size does not match its stored contents", wrongSize.path);
  }

  const labels = combineLabels([
    ...stored.rows.map((row) => row.labels),
    ...input.files.map((file) => pathLabels(file.path, file.mode))
  ]);

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
    // A delete may have removed files between the check above and this lock; never record a
    // version whose files are gone. The device uploads them again.
    const stillStored = await client.query<{ blob_sha: string }>(
      "SELECT blob_sha FROM cloud_blobs WHERE user_id = $1 AND blob_sha = ANY($2::text[])",
      [input.userId, hashes]
    );
    if (stillStored.rows.length !== hashes.length) {
      const present = new Set(stillStored.rows.map((row) => row.blob_sha));
      await client.query("ROLLBACK");
      return { status: "missing_files", missing: hashes.filter((hash) => !present.has(hash)) };
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
      // Only this Mac's own waiting copy is settled by matching the current version.
      await client.query(
        "DELETE FROM cloud_skill_reviews WHERE user_id = $1 AND skill_key = $2 AND device_id IS NOT DISTINCT FROM $3",
        [input.userId, skillKey, input.deviceId]
      );
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
        INSERT INTO cloud_releases (release_id, source_id, device_id, file_count, total_bytes, labels)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [releaseId, sourceId, input.deviceId, manifest.fileCount, manifest.totalBytes, labels]
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
    await client.query("DELETE FROM cloud_skill_reviews WHERE user_id = $1 AND skill_key = $2", [input.userId, skillKey]);
    await client.query("COMMIT");
    return { status: "saved", created: true, skill: { key: skillKey, currentVersion: await readVersion(pool, releaseId) } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Missing files still waiting for the user. Confirmed ones are ordinary missing files: the Mac uploads them next. */
async function heldFiles(db: Database, userId: string, files: SkillManifestEntry[]): Promise<HeldFile[]> {
  if (!files.length) return [];
  const holds = await db.query<{ blob_sha: string; findings: SecretFinding[] }>(
    `
      SELECT blob_sha, findings FROM cloud_secret_holds
      WHERE user_id = $1 AND blob_sha = ANY($2::text[]) AND confirmed_at IS NULL
    `,
    [userId, files.map((file) => file.blobSha)]
  );
  const findings = new Map(holds.rows.map((row) => [row.blob_sha, row.findings]));
  return files
    .filter((file) => findings.has(file.blobSha))
    .map((file) => ({ path: file.path, blobSha: file.blobSha, findings: findings.get(file.blobSha)! }));
}

/** Removes the review for this Mac's waiting copy of a skill, if there is one. Saved copies are untouched. */
export async function dropSkillReview(
  db: Database,
  input: { userId: string; deviceId: string | null; skillKey: unknown }
): Promise<void> {
  await db.query(
    "DELETE FROM cloud_skill_reviews WHERE user_id = $1 AND skill_key = $2 AND device_id IS NOT DISTINCT FROM $3",
    [input.userId, normalizeSkillKey(input.skillKey), input.deviceId]
  );
}

/** The user confirms a held skill is safe; its held files then save on the next try. */
export async function confirmSkillReview(
  db: Database,
  input: { userId: string; deviceId: string | null; skillKey: unknown }
): Promise<CloudSkillReview> {
  const skillKey = normalizeSkillKey(input.skillKey);
  const result = await db.query(
    `
      UPDATE cloud_secret_holds hold
      SET confirmed_at = COALESCE(hold.confirmed_at, now()),
          confirmed_by_device_id = COALESCE(hold.confirmed_by_device_id, $3::uuid)
      FROM cloud_skill_reviews review, jsonb_array_elements(review.files) AS file
      WHERE review.user_id = $1 AND review.skill_key = $2
        AND hold.user_id = review.user_id AND hold.blob_sha = file->>'blobSha'
      RETURNING hold.blob_sha
    `,
    [input.userId, skillKey, input.deviceId]
  );
  if (!result.rowCount) throw new CloudSaveError("not_found", "Nothing is waiting for review for this skill");
  const review = (await readReviews(db, input.userId)).find((candidate) => candidate.key === skillKey);
  if (!review) throw new CloudSaveError("not_found", "Nothing is waiting for review for this skill");
  return review;
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

/**
 * Marks a saved skill as deleted (or back) on the user's Mac. Its cloud copy is kept. A skill
 * deleted while waiting for review no longer waits; a review alone is enough to find it.
 */
export async function markDeletedLocally(
  db: Database,
  input: { userId: string; deviceId?: string | null; skillKey: unknown; deleted: unknown }
): Promise<{ key: string; deletedLocallyAt: string | null }> {
  const skillKey = normalizeSkillKey(input.skillKey);
  if (typeof input.deleted !== "boolean") throw new CloudSaveError("invalid_request", "deleted must be true or false");
  // Only the review for this Mac's copy; another Mac may still have the skill waiting.
  const review = input.deleted
    ? await db.query(
      "DELETE FROM cloud_skill_reviews WHERE user_id = $1 AND skill_key = $2 AND device_id IS NOT DISTINCT FROM $3",
      [input.userId, skillKey, input.deviceId ?? null])
    : { rowCount: 0 };
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
  if (!result.rows[0]) {
    if (review.rowCount) return { key: skillKey, deletedLocallyAt: null };
    throw new CloudSaveError("not_found", "Saved skill not found");
  }
  return { key: skillKey, deletedLocallyAt: result.rows[0].deletedLocallyAt };
}

export type CloudDeleteResult = { deletedSkills: number; freedBytes: number; pendingFiles: number };

/**
 * Deletes saved skills: every version, its file list and the files no remaining version uses.
 * With a skill key, deletes that skill and leaves it out of cloud save so the Mac doesn't save it
 * again; without one, deletes everything the user saved and turns cloud save off. Records go at
 * once; stored files are removed from object storage right after, and any that fail are retried.
 */
export async function deleteCloudSkills(
  pool: Pool,
  store: CloudObjectStore,
  input: { userId: string; skillKey?: unknown }
): Promise<CloudDeleteResult> {
  const skillKey = input.skillKey === undefined ? null : normalizeSkillKey(input.skillKey);
  const client = await pool.connect();
  let result: Omit<CloudDeleteResult, "pendingFiles">;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL omgskills.cloud_purge = 'on'");
    // Takes the upload lock, so no upload or version save runs while records are removed.
    await client.query(
      `
        INSERT INTO cloud_save_settings (user_id, enabled, excluded_skill_keys)
        VALUES ($1, false, CASE WHEN $2::text IS NULL THEN ARRAY[]::text[] ELSE ARRAY[$2::text] END)
        ON CONFLICT (user_id) DO UPDATE SET
          enabled = CASE WHEN $2::text IS NULL THEN false ELSE cloud_save_settings.enabled END,
          excluded_skill_keys = CASE
            WHEN $2::text IS NULL OR $2::text = ANY(cloud_save_settings.excluded_skill_keys) THEN cloud_save_settings.excluded_skill_keys
            -- At the list's limit the skill is still deleted; it just isn't added to the left-out list.
            WHEN cardinality(cloud_save_settings.excluded_skill_keys) >= 5000 THEN cloud_save_settings.excluded_skill_keys
            ELSE array_append(cloud_save_settings.excluded_skill_keys, $2::text)
          END,
          updated_at = now()
      `,
      [input.userId, skillKey]
    );
    await client.query("SELECT 1 FROM cloud_save_settings WHERE user_id = $1 FOR UPDATE", [input.userId]);
    const sources = await client.query<{ id: string }>(
      `
        SELECT id FROM skill_sources
        WHERE kind = 'cloud' AND owner_user_id = $1 AND ($2::text IS NULL OR normalized_root = $2::text)
      `,
      [input.userId, skillKey]
    );
    const sourceIds = sources.rows.map((row) => row.id);
    // Deleting one skill frees only the files its versions used; files uploaded for other skills
    // and not yet part of a version must stay. Deleting everything frees every file.
    const skillFiles = await client.query<{ blob_sha: string }>(
      `
        SELECT DISTINCT file.blob_sha FROM cloud_release_files file
        JOIN cloud_releases release ON release.release_id = file.release_id
        WHERE release.source_id = ANY($1::uuid[])
      `,
      [sourceIds]
    );
    const candidates = skillKey === null ? null : skillFiles.rows.map((row) => row.blob_sha);
    await client.query("DELETE FROM cloud_saved_skills WHERE source_id = ANY($1::uuid[])", [sourceIds]);
    await client.query(
      `
        DELETE FROM cloud_release_files
        WHERE release_id IN (SELECT release_id FROM cloud_releases WHERE source_id = ANY($1::uuid[]))
      `,
      [sourceIds]
    );
    await client.query("DELETE FROM cloud_releases WHERE source_id = ANY($1::uuid[])", [sourceIds]);
    await client.query("DELETE FROM skill_releases WHERE source_id = ANY($1::uuid[])", [sourceIds]);
    await client.query("DELETE FROM skill_sources WHERE id = ANY($1::uuid[])", [sourceIds]);
    await client.query(
      "DELETE FROM cloud_skill_reviews WHERE user_id = $1 AND ($2::text IS NULL OR skill_key = $2::text)",
      [input.userId, skillKey]
    );
    if (skillKey === null) await client.query("DELETE FROM cloud_secret_holds WHERE user_id = $1", [input.userId]);
    // Files no remaining version of this user lists.
    const freed = await client.query<{ blob_sha: string; byte_size: number }>(
      `
        DELETE FROM cloud_blobs blob
        WHERE blob.user_id = $1
          AND ($2::text[] IS NULL OR blob.blob_sha = ANY($2::text[]))
          AND NOT EXISTS (
            SELECT 1
            FROM cloud_release_files file
            JOIN skill_releases release ON release.id = file.release_id
            JOIN skill_sources source ON source.id = release.source_id
            WHERE source.owner_user_id = $1 AND file.blob_sha = blob.blob_sha
          )
        RETURNING blob.blob_sha, blob.byte_size
      `,
      [input.userId, candidates]
    );
    await client.query(
      `
        INSERT INTO cloud_purge_queue (user_id, blob_sha)
        SELECT $1, sha FROM unnest($2::text[]) AS sha
        ON CONFLICT (user_id, blob_sha) DO NOTHING
      `,
      [input.userId, freed.rows.map((row) => row.blob_sha)]
    );
    await client.query("COMMIT");
    result = {
      deletedSkills: sourceIds.length,
      freedBytes: freed.rows.reduce((total, row) => total + row.byte_size, 0)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { ...result, pendingFiles: await drainCloudPurge(pool, store, input.userId) };
}

/** A cheap check without locks, so ordinary reads don't wait on uploads. */
export async function hasPendingPurge(db: Database, userId: string): Promise<boolean> {
  return Boolean((await db.query("SELECT 1 FROM cloud_purge_queue WHERE user_id = $1 LIMIT 1", [userId])).rowCount);
}

/**
 * Removes queued files from object storage, up to `limit`, and returns how many are still queued.
 * Holds the user's upload lock, so a file stored again meanwhile is never removed.
 */
export async function drainCloudPurge(pool: Pool, store: CloudObjectStore, userId: string, limit = 3000): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM cloud_save_settings WHERE user_id = $1 FOR UPDATE", [userId]);
    const queued = await client.query<{ blob_sha: string }>(
      `
        SELECT queue.blob_sha FROM cloud_purge_queue queue
        WHERE queue.user_id = $1
        ORDER BY queue.queued_at, queue.blob_sha
        LIMIT $2
      `,
      [userId, limit]
    );
    const done: string[] = [];
    for (let start = 0; start < queued.rows.length; start += 1000) {
      const batch = queued.rows.slice(start, start + 1000).map((row) => row.blob_sha);
      let failed: string[];
      try {
        failed = await store.deleteMany(batch.map((sha) => cloudBlobKey(userId, sha)));
      } catch {
        break;
      }
      done.push(...batch.filter((sha) => !failed.includes(cloudBlobKey(userId, sha))));
    }
    await client.query("DELETE FROM cloud_purge_queue WHERE user_id = $1 AND blob_sha = ANY($2::text[])", [userId, done]);
    const left = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM cloud_purge_queue WHERE user_id = $1",
      [userId]
    );
    await client.query("COMMIT");
    return left.rows[0].count;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
