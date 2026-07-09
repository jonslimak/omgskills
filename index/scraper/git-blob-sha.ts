import { createHash } from "node:crypto";

/** Git blob SHA-1 over the exact file bytes. No content normalization. */
export function gitBlobSha(bytes: Uint8Array): string {
  const body = Buffer.from(bytes);
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(header).update(body).digest("hex");
}
