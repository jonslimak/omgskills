import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEnv } from "node:util";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const state = path.join(root, ".netlify/portal-integration");
export const directory = path.join(state, "data");
export const database = "omgskills_unified_test";
export const port = 55439;
export const socket = `/private/tmp/og-portal-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
export const backendOrigin = "http://127.0.0.1:8890";
export const frontendOrigin = "http://127.0.0.1:5191";
export const pgBin = "/opt/homebrew/opt/postgresql@16/bin";

export function connectionString(name = database) {
  const url = new URL(`postgresql:///${name}`);
  url.searchParams.set("host", socket);
  url.searchParams.set("port", String(port));
  return url.href;
}

export function cleanEnvironment() {
  return {
    HOME: process.env.HOME,
    USER: process.env.USER,
    PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
    TMPDIR: process.env.TMPDIR || "/private/tmp",
    LC_ALL: "C",
  };
}

export async function verifyDatabase(client, expectedDatabase = database) {
  const { rows: [actual] } = await client.query(
    "SELECT current_database() AS name, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listen, current_setting('unix_socket_directories') AS socket",
  );
  assert.equal(actual.name, expectedDatabase, "Unexpected database");
  assert.equal(await realpath(actual.directory), await realpath(directory), "Unexpected database directory");
  assert.equal(actual.listen, "", "Test database must not listen on TCP");
  assert.equal(actual.socket, socket, "Unexpected database socket");
}

export function clerkFrontend(key) {
  assert.match(key || "", /^pk_test_[A-Za-z0-9+/=]+$/, "A Clerk development publishable key is required");
  const host = Buffer.from(key.slice(8), "base64").toString("utf8");
  assert.match(host, /^[a-z0-9-]+\.clerk\.accounts\.dev\$$/, "Only a Clerk development frontend is allowed");
  return `https://${host.slice(0, -1)}`;
}

export async function developmentKeys() {
  const file = path.join(state, "clerk.env");
  const info = await stat(file);
  assert.equal(info.uid, process.getuid(), "Development keys must belong to the current user");
  assert.equal(info.mode & 0o077, 0, "Development keys must be owner-only (0600)");
  const env = parseEnv(await readFile(file, "utf8"));
  const publicKey = env.VITE_CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;
  const frontend = clerkFrontend(publicKey);
  assert.match(secretKey || "", /^sk_test_[A-Za-z0-9]+$/, "A Clerk development secret key is required");
  return { publicKey, secretKey, frontend };
}

export async function verifyClerk(keys) {
  const read = async (url, headers) => {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, "Clerk development verification failed");
    return response.json();
  };
  const server = await read("https://api.clerk.com/v1/jwks", { Authorization: `Bearer ${keys.secretKey}` });
  const browser = await read(`${keys.frontend}/.well-known/jwks.json`);
  assert.ok(Array.isArray(server.keys) && Array.isArray(browser.keys), "Invalid Clerk keys response");
  assert.ok(server.keys.some(a => browser.keys.some(b => a.kid && a.kid === b.kid && a.n && a.n === b.n && a.e === b.e)),
    "Clerk browser and server must use the same development instance");
}

const readPaths = new Set([
  "/api/portal/synced-skills", "/api/portal/groups", "/api/portal/shared", "/api/portal/profile",
]);
export function allowedRequest(url, method, headers) {
  if (headers.host !== new URL(backendOrigin).host) return false;
  if (headers.origin && ![backendOrigin, frontendOrigin].includes(headers.origin)) return false;
  if (headers["sec-fetch-site"] === "cross-site") return false;
  if (headers["transfer-encoding"] || (headers["content-length"] && headers["content-length"] !== "0")) return false;
  return method === "GET" && readPaths.has(url);
}
