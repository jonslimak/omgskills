import { createHash, createHmac } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_DELETE_KEYS = 1000;
import { getEnv } from "./env.js";

// Private object store for cloud-saved skill files: a Cloudflare R2 bucket reached
// through its S3 API. Objects are named cloud/<user id>/<git blob sha>, so a name
// proves its content and one user's files never share a key with another's.
// Credentials come from CLOUD_SAVE_R2_* and are never logged or returned.

export type CloudObjectStore = {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Deletes up to 1000 objects; returns the keys that could not be deleted. Missing objects count as deleted. */
  deleteMany(keys: string[]): Promise<string[]>;
};

export type CloudObjectPage = { objects: { key: string; modifiedAt: Date }[]; next: string | null };
export type CloudSweepStore = CloudObjectStore & { listCloudObjects(token: string | null, limit: number): Promise<CloudObjectPage> };

export class CloudStoreError extends Error {
  constructor(readonly code: "not_configured" | "not_found" | "unavailable", message: string) {
    super(message);
    this.name = "CloudStoreError";
  }
}

export function cloudBlobKey(userId: string, blobSha: string): string {
  return `cloud/${userId}/${blobSha}`;
}

const encode = (value: string) => encodeURIComponent(value)
  .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** AWS Signature Version 4 headers for one S3 request. */
export function signS3Request(input: {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  now?: Date;
}): Record<string, string> {
  const region = input.region ?? "auto";
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const canonicalPath = input.path.split("/").map(encode).join("/");
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const query = input.query ?? {};
  const canonicalQuery = Object.keys(query).sort().map((key) => `${encode(key)}=${encode(query[key])}`).join("&");
  const canonicalRequest = [input.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

export function createCloudObjectStore(
  env: (key: string) => string | undefined = getEnv,
  fetchImpl: typeof fetch = fetch
): CloudSweepStore {
  const accountId = env("CLOUD_SAVE_R2_ACCOUNT_ID");
  const accessKeyId = env("CLOUD_SAVE_R2_ACCESS_KEY_ID");
  const secretAccessKey = env("CLOUD_SAVE_R2_SECRET_ACCESS_KEY");
  const bucket = env("CLOUD_SAVE_R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new CloudStoreError("not_configured", "Cloud storage is not configured");
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;

  async function request(method: "GET" | "PUT" | "POST", key: string, body?: Uint8Array,
                         options: { query?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Response> {
    const path = key ? `/${bucket}/${key}` : `/${bucket}`;
    const search = Object.entries(options.query ?? {}).map(([name, value]) => `${encode(name)}=${encode(value)}`).join("&");
    for (let attempt = 1; ; attempt += 1) {
      const headers = signS3Request({
        method,
        host,
        path,
        query: options.query,
        payloadHash: sha256(body ?? ""),
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!
      });
      try {
        const response = await fetchImpl(`https://${host}${path.split("/").map(encode).join("/")}${search ? `?${search}` : ""}`, {
          method,
          // A slow store must not hold the upload lock or outlast the function's time limit.
          signal: AbortSignal.timeout(8_000),
          headers: { ...headers, ...(body ? { "content-type": "application/octet-stream" } : {}), ...options.headers },
          body: body ? Buffer.from(body) : undefined
        });
        if (response.status >= 500 && attempt < 3) throw new Error(`R2 ${method} returned ${response.status}`);
        return response;
      } catch (error) {
        if (attempt >= 3) throw new CloudStoreError("unavailable", "Cloud storage is unavailable");
        await new Promise((done) => setTimeout(done, 250 * 2 ** attempt));
      }
    }
  }

  return {
    async listCloudObjects(token, limit) {
      const query: Record<string, string> = { "list-type": "2", prefix: "cloud/", "max-keys": String(limit), "encoding-type": "url" };
      if (token) query["continuation-token"] = token;
      const response = await request("GET", "", undefined, { query });
      if (!response.ok) throw new CloudStoreError("unavailable", "Cloud storage listing is unavailable");
      const xml = await response.text();
      if (XMLValidator.validate(xml) !== true) throw new CloudStoreError("unavailable", "Invalid cloud storage listing");
      const root = new XMLParser({ parseTagValue: false }).parse(xml)?.ListBucketResult;
      if (!root || !["true", "false"].includes(root.IsTruncated)) throw new CloudStoreError("unavailable", "Invalid cloud storage listing");
      const contents = root.Contents === undefined ? [] : Array.isArray(root.Contents) ? root.Contents : [root.Contents];
      const objects = contents.map((entry: { Key?: unknown; LastModified?: unknown }) => {
        if (typeof entry.Key !== "string" || typeof entry.LastModified !== "string") throw new CloudStoreError("unavailable", "Invalid cloud storage object");
        const key = decodeURIComponent(entry.Key);
        const modifiedAt = new Date(entry.LastModified);
        if (!key.startsWith("cloud/") || Number.isNaN(modifiedAt.getTime())) throw new CloudStoreError("unavailable", "Invalid cloud storage object");
        return { key, modifiedAt };
      });
      const next = root.IsTruncated === "true" ? root.NextContinuationToken : null;
      if (root.IsTruncated === "true" && (typeof next !== "string" || !next)) throw new CloudStoreError("unavailable", "Missing cloud storage continuation token");
      return { objects, next };
    },
    async put(key, body) {
      const response = await request("PUT", key, body);
      if (!response.ok) throw new CloudStoreError("unavailable", "Cloud storage is unavailable");
    },
    async deleteMany(keys) {
      if (keys.length === 0) return [];
      if (keys.length > MAX_DELETE_KEYS) throw new Error(`deleteMany takes at most ${MAX_DELETE_KEYS} keys`);
      const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${
        keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join("")}</Delete>`);
      const response = await request("POST", "", xml, {
        query: { delete: "" },
        headers: { "content-type": "application/xml", "content-md5": createHash("md5").update(xml).digest("base64") }
      });
      if (!response.ok) return keys;
      // Quiet mode lists only the keys that failed.
      const failed = [...(await response.text()).matchAll(/<Error>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Error>/g)]
        .map((match) => unescapeXml(match[1]));
      return keys.filter((key) => failed.includes(key));
    },
    async get(key) {
      const response = await request("GET", key);
      if (response.status === 404) throw new CloudStoreError("not_found", "Saved file is missing");
      if (!response.ok) throw new CloudStoreError("unavailable", "Cloud storage is unavailable");
      return Buffer.from(await response.arrayBuffer());
    }
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
