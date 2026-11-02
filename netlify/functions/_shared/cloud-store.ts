import { createHash, createHmac } from "node:crypto";
import { getEnv } from "./env.js";

// Private object store for cloud-saved skill files: a Cloudflare R2 bucket reached
// through its S3 API. Objects are named cloud/<user id>/<git blob sha>, so a name
// proves its content and one user's files never share a key with another's.
// Credentials come from CLOUD_SAVE_R2_* and are never logged or returned.

export type CloudObjectStore = {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
};

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
  const canonicalRequest = [input.method, canonicalPath, "", canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
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
): CloudObjectStore {
  const accountId = env("CLOUD_SAVE_R2_ACCOUNT_ID");
  const accessKeyId = env("CLOUD_SAVE_R2_ACCESS_KEY_ID");
  const secretAccessKey = env("CLOUD_SAVE_R2_SECRET_ACCESS_KEY");
  const bucket = env("CLOUD_SAVE_R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new CloudStoreError("not_configured", "Cloud storage is not configured");
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;

  async function request(method: "GET" | "PUT", key: string, body?: Uint8Array): Promise<Response> {
    const path = `/${bucket}/${key}`;
    for (let attempt = 1; ; attempt += 1) {
      const headers = signS3Request({
        method,
        host,
        path,
        payloadHash: sha256(body ?? ""),
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!
      });
      try {
        const response = await fetchImpl(`https://${host}${path.split("/").map(encode).join("/")}`, {
          method,
          headers: body ? { ...headers, "content-type": "application/octet-stream" } : headers,
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
    async put(key, body) {
      const response = await request("PUT", key, body);
      if (!response.ok) throw new CloudStoreError("unavailable", "Cloud storage is unavailable");
    },
    async get(key) {
      const response = await request("GET", key);
      if (response.status === 404) throw new CloudStoreError("not_found", "Saved file is missing");
      if (!response.ok) throw new CloudStoreError("unavailable", "Cloud storage is unavailable");
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
