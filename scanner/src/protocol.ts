// What Netlify, the Worker and the container send each other. Findings name the rule, file and
// line, never the matched text.

export type Severity = "high" | "medium" | "low" | "info";

export type Finding = {
  rule: string;
  label: string;
  severity: Severity;
  path: string;
  line: number | null;
};

export type ScanStatus = "complete" | "partial" | "failed";

export type ScannerResult = {
  scanner: string;
  version: string;
  status: ScanStatus;
  findings: Finding[];
  filesScanned: number;
  filesSkipped: number;
  startedAt: string;
  finishedAt: string;
};

export type ScannerInfo = { scanner: string; version: string };

/** A file to scan: saved files are read from storage by key; others (private GitHub) come inline. */
export type ScanRequestFile = {
  path: string;
  mode: string;
  blobSha: string;
  byteSize: number;
  storageKey?: string;
  contentBase64?: string;
};

export type ScanRequest = { treeSha: string; files: ScanRequestFile[] };

export type ScanResponse = { treeSha: string; results: ScannerResult[] };

export type ContainerFile = { path: string; mode: string; data: Uint8Array };

/**
 * Files to the container in one body: a 4-byte length, a JSON list of {path, mode, byteSize},
 * then every file's bytes in that order. No base64, so a large skill doesn't double in memory.
 */
export function encodeFiles(files: ContainerFile[]): Uint8Array {
  const { body, offsets } = frameFiles(files.map((file) => ({ path: file.path, mode: file.mode, byteSize: file.data.byteLength })));
  files.forEach((file, index) => body.set(file.data, offsets[index]));
  return body;
}

/**
 * Lays out the body for a list of files before reading them, so each file can be copied straight
 * into its place: one copy of the skill in memory, not two.
 */
export function frameFiles(entries: { path: string; mode: string; byteSize: number }[]): { body: Uint8Array; offsets: number[] } {
  const header = new TextEncoder().encode(JSON.stringify(entries.map(({ path, mode, byteSize }) => ({ path, mode, byteSize }))));
  const total = 4 + header.byteLength + entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  const body = new Uint8Array(total);
  new DataView(body.buffer).setUint32(0, header.byteLength);
  body.set(header, 4);
  const offsets: number[] = [];
  let offset = 4 + header.byteLength;
  for (const entry of entries) {
    offsets.push(offset);
    offset += entry.byteSize;
  }
  return { body, offsets };
}

export function decodeFiles(body: Uint8Array): ContainerFile[] {
  if (body.byteLength < 4) throw new Error("body too short");
  const headerLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  if (4 + headerLength > body.byteLength) throw new Error("header too long");
  const entries = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + headerLength))) as {
    path: string; mode: string; byteSize: number;
  }[];
  if (!Array.isArray(entries)) throw new Error("header is not a list");
  let offset = 4 + headerLength;
  const files = entries.map((entry) => {
    if (typeof entry.path !== "string" || typeof entry.mode !== "string" || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0) {
      throw new Error("bad file entry");
    }
    const end = offset + entry.byteSize;
    if (end > body.byteLength) throw new Error("file runs past the body");
    const data = body.subarray(offset, end);
    offset = end;
    return { path: entry.path, mode: entry.mode, data };
  });
  if (offset !== body.byteLength) throw new Error("extra bytes after the files");
  return files;
}
