#!/usr/bin/env node
// Syncs the hash-named catalog data files between site/data and the R2 bucket.
// Every asset is named <prefix>-<first 12 hex of its SHA-256>.json, so a file's
// name proves its content. Each data folder keeps an assets.txt (tracked in git)
// listing the files it needs; push uploads them and rewrites the list, pull
// restores exactly that list. Credentials come from R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and are never printed.

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DATA_DIRS = ["site/data", "site/data/v2", "site/data/crawl4"];
export const ASSET_LIST = "assets.txt";
const DEFAULT_BUCKET = "omgskills-catalog-data";
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** The 12-hex content hash in an asset name, or null for anything else. */
export function assetHash(name) {
  return /^[a-z0-9][a-z0-9-]*-([0-9a-f]{12})\.json$/.exec(name)?.[1] ?? null;
}

export function contentMatchesName(name, data) {
  const hash = assetHash(name);
  return hash !== null && sha256(data).startsWith(hash);
}

/** Bucket key for a file in a data folder: site/data/v2/x.json -> data/v2/x.json. */
export function objectKey(dir, name) {
  return relative("site", join(dir, name)).split("\\").join("/");
}

export function localAssets(dir) {
  const path = join(repoRoot, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && assetHash(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function readAssetList(dir) {
  const path = join(repoRoot, dir, ASSET_LIST);
  if (!existsSync(path)) throw new Error(`${dir}/${ASSET_LIST} is missing; run push from a full checkout first`);
  const names = readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const invalid = names.find((name) => !assetHash(name));
  if (invalid) throw new Error(`${dir}/${ASSET_LIST} lists a name that is not a hashed asset: ${invalid}`);
  return names;
}

function writeAssetList(dir, names) {
  const path = join(repoRoot, dir, ASSET_LIST);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, names.length ? `${names.join("\n")}\n` : "");
  renameSync(temporary, path);
}

/** Uploads to make and names to list, from the local files and the bucket's keys. */
export function planPush(dir, local, remoteKeys) {
  return { upload: local.filter((name) => !remoteKeys.has(objectKey(dir, name))), list: local };
}

/** Downloads to make: listed names that are absent locally or whose content does not match. */
export function planPull(listed, readLocal) {
  return listed.filter((name) => {
    const data = readLocal(name);
    return data === null || !contentMatchesName(name, data);
  });
}

export function parseListObjects(xml) {
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
  return { keys, next: truncated ? token : null };
}

const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature Version 4 headers for one S3 request. */
export function signRequest({ method, host, path, query = {}, payloadHash, accessKeyId, secretAccessKey, region = "auto", now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const canonicalPath = path.split("/").map(encode).join("/");
  const canonicalQuery = Object.keys(query).sort().map((key) => `${encode(key)}=${encode(query[key])}`).join("&");
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${headers[key]}\n`).join("");
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function createR2Client(env = process.env, fetchImpl = fetch) {
  const accountId = env.R2_ACCOUNT_ID, accessKeyId = env.R2_ACCESS_KEY_ID, secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required");
  }
  const bucket = env.R2_BUCKET || DEFAULT_BUCKET;
  const host = `${accountId}.r2.cloudflarestorage.com`;

  async function request(method, key, { query = {}, body } = {}) {
    const path = `/${bucket}${key ? `/${key}` : ""}`;
    const payloadHash = body ? sha256(body) : EMPTY_SHA256;
    for (let attempt = 1; ; attempt++) {
      const headers = signRequest({ method, host, path, query, payloadHash, accessKeyId, secretAccessKey });
      const search = new URLSearchParams(query).toString();
      try {
        const response = await fetchImpl(`https://${host}${path.split("/").map(encode).join("/")}${search ? `?${search}` : ""}`,
          { method, headers: body ? { ...headers, "content-type": "application/json" } : headers, body });
        if (response.status >= 500 && attempt < 4) throw new Error(`R2 ${method} returned ${response.status}`);
        return response;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
      }
    }
  }

  return {
    bucket,
    async listKeys(prefix) {
      const keys = new Set();
      let token = null;
      do {
        const query = { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) };
        const response = await request("GET", "", { query });
        if (!response.ok) throw new Error(`R2 list ${prefix} failed: ${response.status}`);
        const page = parseListObjects(await response.text());
        for (const key of page.keys) keys.add(key);
        token = page.next;
      } while (token);
      return keys;
    },
    async put(key, body) {
      const response = await request("PUT", key, { body });
      if (!response.ok) throw new Error(`R2 upload ${key} failed: ${response.status}`);
    },
    async get(key) {
      const response = await request("GET", key);
      if (!response.ok) throw new Error(`R2 download ${key} failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

async function inPool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/** Prefix within a data folder's keys: data/ lists only the root folder's files. */
const listPrefix = (dir) => `${objectKey(dir, "x").slice(0, -1)}`;

async function rootKeys(client, dir) {
  const keys = await client.listKeys(listPrefix(dir));
  // data/ also matches data/v2/...; keep only this folder's direct children.
  return new Set([...keys].filter((key) => !key.slice(listPrefix(dir).length).includes("/")));
}

export async function push(client, dirs, { dryRun = false, log = console.log } = {}) {
  const summary = {};
  for (const dir of dirs) {
    const local = localAssets(dir);
    for (const name of local) {
      if (!contentMatchesName(name, readFileSync(join(repoRoot, dir, name)))) throw new Error(`${dir}/${name} does not match its name's hash`);
    }
    const plan = planPush(dir, local, await rootKeys(client, dir));
    let uploadedBytes = 0;
    if (!dryRun) {
      await inPool(plan.upload, 6, async (name) => {
        const body = readFileSync(join(repoRoot, dir, name));
        await client.put(objectKey(dir, name), body);
        uploadedBytes += body.length;
      });
      writeAssetList(dir, plan.list);
    }
    summary[dir] = { local: local.length, uploaded: dryRun ? 0 : plan.upload.length, toUpload: plan.upload.length, uploadedBytes };
    log(`${dir}: ${local.length} assets, ${dryRun ? `${plan.upload.length} to upload (dry run)` : `${plan.upload.length} uploaded`}`);
  }
  return summary;
}

export async function pull(client, dirs, { log = console.log } = {}) {
  const summary = {};
  for (const dir of dirs) {
    const listed = readAssetList(dir);
    const read = (name) => { const path = join(repoRoot, dir, name); return existsSync(path) ? readFileSync(path) : null; };
    const missing = planPull(listed, read);
    mkdirSync(join(repoRoot, dir), { recursive: true });
    await inPool(missing, 6, async (name) => {
      const data = await client.get(objectKey(dir, name));
      if (!contentMatchesName(name, data)) throw new Error(`downloaded ${dir}/${name} does not match its name's hash`);
      const path = join(repoRoot, dir, name);
      writeFileSync(`${path}.tmp-${process.pid}`, data);
      renameSync(`${path}.tmp-${process.pid}`, path);
    });
    summary[dir] = { listed: listed.length, downloaded: missing.length };
    log(`${dir}: ${listed.length} listed, ${missing.length} downloaded`);
  }
  return summary;
}

/**
 * Restores listed assets that are absent locally, for folders that have an asset list.
 * Credentials are needed only when something is missing.
 */
export async function pullMissing(dirs = DATA_DIRS, { env = process.env, log = console.log, makeClient = createR2Client } = {}) {
  const pending = dirs.filter((dir) => {
    if (!existsSync(join(repoRoot, dir, ASSET_LIST))) return false;
    const read = (name) => { const path = join(repoRoot, dir, name); return existsSync(path) ? readFileSync(path) : null; };
    return planPull(readAssetList(dir), read).length > 0;
  });
  if (!pending.length) return {};
  return pull(makeClient(env), pending, { log });
}

/** Fails when a listed asset is not in the bucket. */
export async function check(client, dirs, { log = console.log } = {}) {
  const summary = {};
  for (const dir of dirs) {
    const listed = readAssetList(dir);
    const remote = await rootKeys(client, dir);
    const absent = listed.filter((name) => !remote.has(objectKey(dir, name)));
    summary[dir] = { listed: listed.length, absent: absent.length };
    log(`${dir}: ${listed.length} listed, ${absent.length} absent from ${client.bucket}`);
    if (absent.length) throw new Error(`${dir} lists ${absent.length} assets missing from the bucket, e.g. ${absent[0]}`);
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: "string", multiple: true }, "dry-run": { type: "boolean", default: false } },
  });
  const [command] = positionals;
  const dirs = values.dir?.length ? values.dir : DATA_DIRS;
  const unknown = dirs.find((dir) => !DATA_DIRS.includes(dir));
  if (!["push", "pull", "check"].includes(command) || positionals.length !== 1 || unknown) {
    console.error(`Usage: node scripts/data-store.mjs push|pull|check [--dir ${DATA_DIRS.join("|")}]... [--dry-run]`);
    process.exit(2);
  }
  const client = createR2Client();
  const run = { push: () => push(client, dirs, { dryRun: values["dry-run"] }), pull: () => pull(client, dirs), check: () => check(client, dirs) }[command];
  run().catch((error) => {
    console.error(`data-store: ${error.message}`);
    process.exit(1);
  });
}
