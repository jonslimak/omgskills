import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decodeFiles, type ScannerResult } from "../../src/protocol.js";
import { scanners as allScanners } from "./scanners/index.js";
import type { Scanner } from "./scanners/types.js";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Runs every scanner; one that throws counts as failed, never as clean. */
export async function runScanners(list: Scanner[], body: Uint8Array): Promise<ScannerResult[]> {
  const files = decodeFiles(body);
  const results: ScannerResult[] = [];
  for (const scanner of list) {
    const startedAt = new Date().toISOString();
    try {
      const result = await scanner.scan(files);
      results.push({ scanner: scanner.name, version: scanner.version, ...result, startedAt, finishedAt: new Date().toISOString() });
    } catch {
      results.push({
        scanner: scanner.name, version: scanner.version, status: "failed", findings: [],
        filesScanned: 0, filesSkipped: files.length, startedAt, finishedAt: new Date().toISOString()
      });
    }
  }
  return results;
}

/** True only if the open internet answers; the container is meant to have none. */
export async function internetReachable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await fetchImpl("https://example.com/", { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createScannerServer(list: Scanner[]) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/scanners") {
        return send(response, 200, { scanners: list.map((scanner) => ({ scanner: scanner.name, version: scanner.version })) });
      }
      if (request.method === "GET" && request.url === "/selftest") {
        return send(response, 200, { internet: await internetReachable() });
      }
      if (request.method === "POST" && request.url === "/scan") {
        return send(response, 200, { results: await runScanners(list, await readBody(request)) });
      }
      return send(response, 404, { error: "not_found" });
    } catch {
      return send(response, 400, { error: "bad_request" });
    }
  });
}

declare const OMG_RULES_VERSION: string | undefined;

// Started by the bundled image (see scripts/build-container.mjs); tests import the functions instead.
if (process.env.SCANNER_LISTEN === "1") {
  const version = typeof OMG_RULES_VERSION === "string" ? OMG_RULES_VERSION : "dev";
  createScannerServer(allScanners({ omgRules: version })).listen(8080, "0.0.0.0");
}
