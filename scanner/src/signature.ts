// Requests to the scan Worker are signed with a key only Netlify and the Worker hold:
// HMAC-SHA256 over method, path, timestamp and the body's SHA-256, valid for five minutes.

export const SIGNATURE_HEADER = "x-omgskills-signature";
export const TIMESTAMP_HEADER = "x-omgskills-timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unhex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function key(secret: string) {
  if (secret.length < 32) throw new Error("signing key is too short");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function message(method: string, path: string, timestamp: string, body: Uint8Array) {
  const digest = hex(await crypto.subtle.digest("SHA-256", body as BufferSource));
  return encoder.encode(`${method.toUpperCase()}\n${path}\n${timestamp}\n${digest}`);
}

export async function signRequest(secret: string, method: string, path: string, body: Uint8Array, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = hex(await crypto.subtle.sign("HMAC", await key(secret), await message(method, path, timestamp, body)));
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature };
}

export async function verifyRequest(
  secret: string,
  request: { method: string; path: string; timestamp: string | null; signature: string | null; body: Uint8Array },
  now = Date.now()
): Promise<boolean> {
  if (!request.timestamp || !/^\d{1,12}$/.test(request.timestamp) || !request.signature) return false;
  if (Math.abs(now / 1000 - Number(request.timestamp)) > MAX_SKEW_SECONDS) return false;
  const signature = unhex(request.signature);
  if (!signature) return false;
  return crypto.subtle.verify(
    "HMAC", await key(secret), signature as BufferSource, await message(request.method, request.path, request.timestamp, request.body)
  );
}
