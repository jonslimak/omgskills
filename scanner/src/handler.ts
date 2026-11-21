import {
  STANDARD_SKILL_PACKAGE_LIMITS,
  gitObjectSha,
  validateSkillManifest
} from "../../netlify/functions/_shared/skill-package.js";
import {
  frameFiles,
  type ScanRequest,
  type ScanRequestFile,
  type ScanResponse,
  type ScannerInfo,
  type ScannerResult
} from "./protocol.js";
import { MAX_SKEW_SECONDS, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequest } from "./signature.js";

/** What the Worker needs from Cloudflare, so the logic runs in tests without it. */
export type ScanDependencies = {
  signingKey: string;
  /** Reads a saved file; null when it's gone (the skill was deleted mid-scan). */
  readStoredFile(key: string): Promise<Uint8Array | null>;
  /** Sends a request to the scanner container (no internet, no keys). */
  container(path: string, init?: { method: string; body?: Uint8Array }): Promise<Response>;
  now?: () => number;
};

/** The signed request itself: file list and inline files (private GitHub's limit is 12MB). */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
/** What one scan holds in memory at once; a bigger skill gets a partial result, never a crash. */
export const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CLOUD_KEY = new RegExp(`^cloud/${UUID}/([0-9a-f]{40})(?:/${UUID})?$`);
const SHA = /^[0-9a-f]{40}$/;

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new RequestError(400, "bad_content");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Reads the body, stopping as soon as it passes the limit (a missing length can't get around it). */
async function readCapped(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) throw new RequestError(413, "too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestError(413, "too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseScanRequest(body: Uint8Array): ScanRequest {
  let parsed: ScanRequest;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RequestError(400, "bad_json");
  }
  if (!parsed || typeof parsed.treeSha !== "string" || !SHA.test(parsed.treeSha) || !Array.isArray(parsed.files)) {
    throw new RequestError(400, "bad_request");
  }
  return parsed;
}

/**
 * Checks the file list against the tree hash, then reads each file straight into the body sent to
 * the container, checking it against its own hash. Null when the skill is too big to scan whole.
 */
async function loadFiles(request: ScanRequest, deps: ScanDependencies): Promise<Uint8Array | null> {
  let manifest;
  try {
    manifest = validateSkillManifest(
      request.files.map((file: ScanRequestFile) => ({
        path: file.path, mode: file.mode, blobSha: file.blobSha, byteSize: file.byteSize
      })),
      STANDARD_SKILL_PACKAGE_LIMITS
    );
  } catch {
    throw new RequestError(422, "bad_manifest");
  }
  if (manifest.treeSha !== request.treeSha) throw new RequestError(422, "tree_mismatch");
  if (manifest.totalBytes > MAX_SCAN_BYTES) return null;

  const { body, offsets } = frameFiles(request.files);
  for (const [index, file] of request.files.entries()) {
    let data: Uint8Array | null;
    if (typeof file.storageKey === "string") {
      const match = CLOUD_KEY.exec(file.storageKey);
      if (!match || match[1] !== file.blobSha) throw new RequestError(400, "bad_storage_key");
      data = await deps.readStoredFile(file.storageKey);
      if (!data) throw new RequestError(409, "file_missing");
    } else if (typeof file.contentBase64 === "string") {
      data = fromBase64(file.contentBase64);
    } else {
      throw new RequestError(400, "no_content");
    }
    if (data.byteLength !== file.byteSize || gitObjectSha("blob", data) !== file.blobSha) {
      throw new RequestError(422, "file_mismatch");
    }
    body.set(data, offsets[index]);
  }
  return body;
}

async function readContainerJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new RequestError(502, "scanner_failed");
  return (await response.json()) as T;
}

/** Every scanner, partial: the skill was too big to read whole, so nothing about it counts as clean. */
async function tooBig(request: ScanRequest, deps: ScanDependencies): Promise<ScannerResult[]> {
  const { scanners } = await readContainerJson<{ scanners: ScannerInfo[] }>(await deps.container("/scanners"));
  const now = new Date(deps.now?.() ?? Date.now()).toISOString();
  return scanners.map(({ scanner, version }) => ({
    scanner, version, status: "partial", findings: [],
    filesScanned: 0, filesSkipped: request.files.length, startedAt: now, finishedAt: now
  }));
}

/**
 * The Worker's routes, all signed:
 *   POST /scan       files (stored or inline) → every scanner's results
 *   GET  /scanners   the scanners and versions the container runs now
 *   GET  /selftest   proves the container can't reach the internet
 */
export async function handle(request: Request, deps: ScanDependencies): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (!["POST /scan", "GET /scanners", "GET /selftest"].includes(route)) return json(404, { error: "not_found" });
  if (typeof deps.signingKey !== "string" || deps.signingKey.length < 32) return json(503, { error: "not_configured" });

  try {
    // Turn away anything unsigned or stale before reading the body.
    const timestamp = request.headers.get(TIMESTAMP_HEADER);
    const signature = request.headers.get(SIGNATURE_HEADER);
    const now = deps.now?.() ?? Date.now();
    if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
      return json(401, { error: "unauthorized" });
    }
    const body = await readCapped(request);
    if (!(await verifyRequest(deps.signingKey, { method: request.method, path: url.pathname, timestamp, signature, body }, now))) {
      return json(401, { error: "unauthorized" });
    }

    if (route === "GET /scanners") {
      return json(200, await readContainerJson<{ scanners: ScannerInfo[] }>(await deps.container("/scanners")));
    }
    if (route === "GET /selftest") {
      return json(200, await readContainerJson<{ internet: boolean }>(await deps.container("/selftest")));
    }
    const scanRequest = parseScanRequest(body);
    const files = await loadFiles(scanRequest, deps);
    const results = files
      ? (await readContainerJson<{ results: ScannerResult[] }>(await deps.container("/scan", { method: "POST", body: files }))).results
      : await tooBig(scanRequest, deps);
    const response: ScanResponse = { treeSha: scanRequest.treeSha, results };
    return json(200, response);
  } catch (error) {
    if (error instanceof RequestError) return json(error.status, { error: error.code });
    // Never echo file contents or internals back.
    return json(500, { error: "internal" });
  }
}
