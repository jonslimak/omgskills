import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { cloudBlobKey } from "./cloud-store.js";
import type { SkillPackage } from "./skill-package.js";
import type { ScanRequestFile, ScanResponse, ScannerInfo, ScannerResult } from "../../../scanner/src/protocol.js";
import { signRequest } from "../../../scanner/src/signature.js";

/*
 * Runs the scan queue in the background. Every couple of minutes: ask the scanner which scanners
 * and versions it runs, queue any live private version that has no result for one of them, then
 * lease due jobs, send each skill's files to the scanner and store what comes back. Nothing a
 * person does waits on this; a skill is usable the moment it's saved, and results show up later.
 */

export type ScanDriverConfig = { workerUrl: string; signingKey: string };

export type ScanDriverDeps = {
  config: ScanDriverConfig;
  fetch?: typeof fetch;
  /** Reads a private GitHub version's files (from GitHub, through the broker). */
  loadPrivatePackage(input: { ownerUserId: string; releaseId: string }): Promise<SkillPackage>;
  now?: () => number;
};

export type ScanRunResult = {
  queued: number; scanned: number; alreadyScanned: number; retried: number; dropped: number; stoppedBy?: string;
  /** Why jobs didn't finish (retried or given up), by error code; never file contents. */
  errors: Record<string, number>;
};

/**
 * Scheduled functions stop at about 30 s; everything in a run, storing included, ends by this.
 * A job starts only if the time left covers its reads and its scanner call.
 */
const DEFAULT_RUN_LIMIT_MS = 25_000;
/** Kept for storing results after the last scanner call. */
const STORE_MARGIN_MS = 1_500;
/**
 * A scanner call needs at least this much time left to start; one that timed out before waits
 * for the longer slot. Every call gets whatever the run has left, up to the maximum.
 */
const SCAN_TIMEOUT_MS = 8_000;
const RETRY_SCAN_TIMEOUT_MS = 12_000;
const MAX_SCAN_TIMEOUT_MS = 20_000;
/** The scanner list, which also wakes the scanner for the scans after it. */
const LIST_TIMEOUT_MS = 12_000;
/** Reading a private GitHub version's files. */
const GITHUB_TIMEOUT_MS = 6_000;
/** Longer than any run, so a crashed run's jobs come back by themselves. */
const LEASE = "2 minutes";
const BATCH = 5;
export const MAX_ATTEMPTS = 6;
const SWEEP_LIMIT = 500;

export function scanDriverConfigFromEnv(env: Record<string, string | undefined> = process.env): ScanDriverConfig | null {
  const workerUrl = env.SCAN_WORKER_URL?.trim();
  // Used exactly as set: the Worker gets the same value, untrimmed.
  const signingKey = env.SCAN_SIGNING_KEY;
  if (!workerUrl || !signingKey || signingKey.length < 32) return null;
  return { workerUrl: workerUrl.replace(/\/+$/, ""), signingKey };
}

class ScannerCallError extends Error {
  constructor(readonly code: string, readonly retry: boolean, readonly stopRun = false) {
    super(code);
  }
}

async function callScanner<T>(deps: ScanDriverDeps, method: "GET" | "POST", path: string, timeoutMs: number, body?: unknown): Promise<T> {
  const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
  const headers = await signRequest(deps.config.signingKey, method, path, bytes, deps.now?.() ?? Date.now());
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${deps.config.workerUrl}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: method === "GET" ? undefined : bytes,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new ScannerCallError("unreachable", true);
  }
  if (!response.ok) {
    let code = `http_${response.status}`;
    try {
      const parsed = await response.json() as { error?: unknown };
      if (typeof parsed.error === "string" && /^[a-z_]{1,40}$/.test(parsed.error)) code = parsed.error;
    } catch {
      // Keep the status code.
    }
    // A refused signature means the keys don't match: stop the run, it's not the job's fault.
    if (response.status === 401) throw new ScannerCallError("unauthorized", true, true);
    // A bad request won't get better by itself; anything else might.
    throw new ScannerCallError(code, ![400, 413, 422].includes(response.status));
  }
  return await response.json() as T;
}

const SCANNER_INFO = /^[a-z0-9][a-z0-9-]{0,62}$/;

function validScanners(value: unknown): ScannerInfo[] {
  const list = (value as { scanners?: unknown })?.scanners;
  if (!Array.isArray(list) || list.length === 0) throw new ScannerCallError("bad_scanner_list", true);
  return list.map((item) => {
    const { scanner, version } = item as ScannerInfo;
    if (typeof scanner !== "string" || !SCANNER_INFO.test(scanner) || typeof version !== "string" || version.length < 1 || version.length > 64) {
      throw new ScannerCallError("bad_scanner_list", true);
    }
    return { scanner, version };
  });
}

/**
 * Live private versions that some current scanner has no result for, and no job: new scanner
 * versions, and any version saved while this wasn't running. Saved skills count their current
 * version; private GitHub skills their newest version and any version a Set holds.
 */
async function queueMissing(pool: Pool, scanners: ScannerInfo[]): Promise<number> {
  try {
    return await insertMissing(pool, scanners);
  } catch (error) {
    // A version deleted while this ran; the next run picks up where this left off.
    if ((error as { code?: string }).code === "23503") return 0;
    throw error;
  }
}

async function insertMissing(pool: Pool, scanners: ScannerInfo[]): Promise<number> {
  const result = await pool.query(
    `
      WITH current_scanner AS (
        SELECT * FROM unnest($1::text[], $2::text[]) AS s(scanner, version)
      ), wanted AS (
        SELECT saved.current_release_id AS release_id
        FROM cloud_saved_skills saved
        JOIN skill_sources source ON source.id = saved.source_id AND source.tombstoned_at IS NULL
        UNION
        (
          SELECT DISTINCT ON (release.source_id) release.id
          FROM skill_releases release
          JOIN skill_sources source ON source.id = release.source_id
          WHERE source.kind = 'private_github' AND source.tombstoned_at IS NULL
          ORDER BY release.source_id, release.created_at DESC
        )
        UNION
        SELECT item.release_id
        FROM skill_group_items item
        JOIN skill_sources source ON source.id = item.source_id
        WHERE source.kind IN ('cloud', 'private_github') AND source.tombstoned_at IS NULL AND item.release_id IS NOT NULL
      )
      INSERT INTO scan_jobs (release_id, tree_sha)
      SELECT release.id, release.tree_sha
      FROM wanted
      JOIN skill_releases release ON release.id = wanted.release_id
      WHERE NOT EXISTS (SELECT 1 FROM scan_jobs job WHERE job.release_id = release.id)
        AND EXISTS (
          SELECT 1 FROM current_scanner
          WHERE NOT EXISTS (
            SELECT 1 FROM skill_scans scan
            WHERE scan.tree_sha = release.tree_sha
              AND scan.scanner = current_scanner.scanner
              AND scan.scanner_version = current_scanner.version
          )
        )
      LIMIT ${SWEEP_LIMIT}
      ON CONFLICT (release_id) DO NOTHING
    `,
    [scanners.map((s) => s.scanner), scanners.map((s) => s.version)]
  );
  return result.rowCount ?? 0;
}

type LeasedJob = {
  releaseId: string;
  treeSha: string;
  attempts: number;
  leaseToken: string;
  kind: string;
  ownerUserId: string | null;
  tombstoned: boolean;
  scanned: boolean;
  /** Why the last try didn't finish, if it didn't. */
  lastError: string | null;
};

/** Newest first, so fresh saves get results quickly while older ones fill in behind; timed-out ones lead. */
async function leaseJobs(pool: Pool, scanners: ScannerInfo[], limit: number, skip: string[]): Promise<LeasedJob[]> {
  const leaseToken = randomUUID();
  const result = await pool.query<LeasedJob>(
    `
      WITH due AS (
        SELECT release_id FROM scan_jobs
        WHERE not_before <= now() AND (lease_until IS NULL OR lease_until < now()) AND attempts < $3
          AND NOT (release_id = ANY($6::uuid[]))
        -- One that timed out goes first, while the run still has time for its longer try.
        ORDER BY (last_error = 'unreachable') DESC NULLS LAST, queued_at DESC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      ), leased AS (
        UPDATE scan_jobs job
        SET lease_token = $1, lease_until = now() + interval '${LEASE}', attempts = job.attempts + 1
        FROM due WHERE job.release_id = due.release_id
        RETURNING job.release_id, job.tree_sha, job.attempts, job.lease_token, job.last_error
      )
      SELECT leased.release_id AS "releaseId", leased.tree_sha AS "treeSha", leased.attempts,
        leased.lease_token AS "leaseToken", leased.last_error AS "lastError", source.kind, source.owner_user_id AS "ownerUserId",
        source.tombstoned_at IS NOT NULL AS tombstoned,
        NOT EXISTS (
          SELECT 1 FROM unnest($4::text[], $5::text[]) AS s(scanner, version)
          WHERE NOT EXISTS (
            SELECT 1 FROM skill_scans scan
            WHERE scan.tree_sha = leased.tree_sha AND scan.scanner = s.scanner AND scan.scanner_version = s.version
              AND scan.status <> 'failed'
          )
        ) AS scanned
      FROM leased
      JOIN skill_releases release ON release.id = leased.release_id
      JOIN skill_sources source ON source.id = release.source_id
    `,
    [leaseToken, limit, MAX_ATTEMPTS, scanners.map((s) => s.scanner), scanners.map((s) => s.version), skip]
  );
  return result.rows;
}

/** A saved version's files, by storage key; the scanner reads them from storage itself. */
async function cloudFiles(pool: Pool, releaseId: string): Promise<ScanRequestFile[]> {
  const result = await pool.query<{ path: string; mode: string; blob_sha: string; byte_size: number; user_id: string; storage_key: string | null }>(
    `
      SELECT file.path, file.mode, file.blob_sha, file.byte_size, blob.user_id, blob.storage_key
      FROM cloud_release_files file
      JOIN skill_releases release ON release.id = file.release_id
      JOIN skill_sources source ON source.id = release.source_id
      JOIN cloud_blobs blob ON blob.user_id = source.owner_user_id AND blob.blob_sha = file.blob_sha
      WHERE file.release_id = $1
      ORDER BY file.path COLLATE "C"
    `,
    [releaseId]
  );
  return result.rows.map((row) => ({
    path: row.path,
    mode: row.mode,
    blobSha: row.blob_sha,
    byteSize: row.byte_size,
    storageKey: row.storage_key ?? cloudBlobKey(row.user_id, row.blob_sha)
  }));
}

async function requestFiles(pool: Pool, deps: ScanDriverDeps, job: LeasedJob): Promise<ScanRequestFile[]> {
  if (job.kind === "cloud") return cloudFiles(pool, job.releaseId);
  if (!job.ownerUserId) throw new ScannerCallError("no_owner", false);
  let skillPackage: SkillPackage;
  try {
    skillPackage = await Promise.race([
      deps.loadPrivatePackage({ ownerUserId: job.ownerUserId, releaseId: job.releaseId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), GITHUB_TIMEOUT_MS).unref())
    ]);
  } catch {
    throw new ScannerCallError("github_unavailable", true);
  }
  return skillPackage.entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    blobSha: entry.blobSha,
    byteSize: entry.data.byteLength,
    contentBase64: entry.data.toString("base64")
  }));
}

/**
 * Stores results only while this run still holds the job. A job that's gone means the skill was
 * deleted mid-scan, so its results are dropped. A failed scanner is retried, and its failure is
 * only stored once the tries run out. A result is only ever replaced by a better one.
 */
async function storeResults(pool: Pool, job: LeasedJob, results: ScannerResult[]): Promise<"stored" | "retry" | "dropped"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const held = await client.query(
      "SELECT 1 FROM scan_jobs WHERE release_id = $1 AND lease_token = $2 FOR UPDATE",
      [job.releaseId, job.leaseToken]
    );
    if (!held.rowCount) {
      await client.query("ROLLBACK");
      return "dropped";
    }
    const failed = results.some((result) => result.status === "failed");
    const lastTry = job.attempts >= MAX_ATTEMPTS;
    for (const result of results) {
      if (result.status === "failed" && !lastTry) continue;
      await client.query(
        `
          INSERT INTO skill_scans (tree_sha, scanner, scanner_version, status, findings, files_scanned, files_skipped, started_at, finished_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
          ON CONFLICT (tree_sha, scanner, scanner_version) DO UPDATE SET
            status = EXCLUDED.status, findings = EXCLUDED.findings, files_scanned = EXCLUDED.files_scanned,
            files_skipped = EXCLUDED.files_skipped, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at
          WHERE skill_scans.status = 'failed' OR (skill_scans.status = 'partial' AND EXCLUDED.status = 'complete')
        `,
        [
          job.treeSha, result.scanner, result.version, result.status, JSON.stringify(result.findings),
          result.filesScanned, result.filesSkipped, result.startedAt, result.finishedAt
        ]
      );
    }
    if (failed && !lastTry) {
      await retryLater(client, job, "scanner_failed");
      await client.query("COMMIT");
      return "retry";
    }
    await client.query("DELETE FROM scan_jobs WHERE release_id = $1", [job.releaseId]);
    await client.query("COMMIT");
    return "stored";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Backs off 4, 8, 16… minutes. After the last attempt the job stays, unleased, for a person to look at. */
async function retryLater(client: Pick<Pool, "query">, job: LeasedJob, code: string) {
  await client.query(
    `
      UPDATE scan_jobs
      SET lease_token = NULL, lease_until = NULL, last_error = $3,
          not_before = now() + make_interval(mins => power(2, LEAST(attempts, 8))::int)
      WHERE release_id = $1 AND lease_token = $2
    `,
    [job.releaseId, job.leaseToken, code]
  );
}

async function finishJob(pool: Pool, job: LeasedJob) {
  await pool.query("DELETE FROM scan_jobs WHERE release_id = $1 AND lease_token = $2", [job.releaseId, job.leaseToken]);
}

/** One scheduled run. Does nothing until the scanner is set up (SCAN_WORKER_URL, SCAN_SIGNING_KEY). */
export async function runScanQueue(pool: Pool, deps: ScanDriverDeps, runLimitMs = DEFAULT_RUN_LIMIT_MS): Promise<ScanRunResult> {
  const started = deps.now?.() ?? Date.now();
  const elapsed = () => (deps.now?.() ?? Date.now()) - started;
  const result: ScanRunResult = { queued: 0, scanned: 0, alreadyScanned: 0, retried: 0, dropped: 0, errors: {} };

  const scanners = validScanners(await callScanner<unknown>(deps, "GET", "/scanners", LIST_TIMEOUT_MS));
  result.queued = await queueMissing(pool, scanners);

  // Hands a job back for a later run without counting this try; this run doesn't lease it again,
  // so it never holds up the jobs behind it.
  const handedBack: string[] = [];
  const handBack = (job: LeasedJob) => {
    handedBack.push(job.releaseId);
    return pool.query(
      "UPDATE scan_jobs SET lease_token = NULL, lease_until = NULL, attempts = attempts - 1 WHERE release_id = $1 AND lease_token = $2",
      [job.releaseId, job.leaseToken]
    );
  };
  let stopped = false;

  // How long this job's scanner call may take, or null if the run hasn't time for a fair try.
  // One that timed out before waits until it can have the long allowance.
  const allowance = (job: LeasedJob): number | null => {
    const reads = job.kind === "cloud" ? 0 : GITHUB_TIMEOUT_MS;
    const left = runLimitMs - elapsed() - STORE_MARGIN_MS - reads;
    const needed = job.lastError === "unreachable" ? RETRY_SCAN_TIMEOUT_MS : SCAN_TIMEOUT_MS;
    return left >= needed ? Math.min(left, MAX_SCAN_TIMEOUT_MS) : null;
  };

  while (!stopped && runLimitMs - elapsed() - STORE_MARGIN_MS >= SCAN_TIMEOUT_MS) {
    const jobs = await leaseJobs(pool, scanners, BATCH, handedBack);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      if (job.tombstoned || job.scanned) {
        await finishJob(pool, job);
        result.alreadyScanned += 1;
        continue;
      }
      const timeoutMs = stopped ? null : allowance(job);
      if (timeoutMs === null) {
        await handBack(job);
        continue;
      }
      try {
        const files = await requestFiles(pool, deps, job);
        const response = await callScanner<ScanResponse>(deps, "POST", "/scan", timeoutMs, { treeSha: job.treeSha, files });
        if (response.treeSha !== job.treeSha || !Array.isArray(response.results)) throw new ScannerCallError("bad_response", true);
        const stored = await storeResults(pool, job, response.results);
        if (stored === "stored") result.scanned += 1;
        else if (stored === "retry") {
          result.retried += 1;
          result.errors.scanner_failed = (result.errors.scanner_failed ?? 0) + 1;
        }
        else result.dropped += 1;
      } catch (error) {
        const code = error instanceof ScannerCallError ? error.code : "internal";
        if (error instanceof ScannerCallError && error.stopRun) {
          // The keys don't match; no job is at fault. Stop, and say so in the run's log.
          await handBack(job);
          stopped = true;
          result.stoppedBy = code;
          continue;
        }
        if (!(error instanceof ScannerCallError) || error.retry) {
          await retryLater(pool, job, code);
        } else {
          // A bad request is a bug on our side: stop retrying it, but keep the job so it shows.
          await pool.query(
            "UPDATE scan_jobs SET lease_token = NULL, lease_until = NULL, last_error = $3, attempts = $4 WHERE release_id = $1 AND lease_token = $2",
            [job.releaseId, job.leaseToken, code, MAX_ATTEMPTS]
          );
        }
        result.retried += 1;
        result.errors[code] = (result.errors[code] ?? 0) + 1;
      }
    }
  }
  return result;
}
