import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

const manifestUrl = new URL("../config/helper-release.json", import.meta.url);
const productionOrigin = "https://omgskills.com";
const updateDirectory = "helper/updates";
const feedPath = `${updateDirectory}/appcast.xml`;
const dmgPathPattern = /^helper\/updates\/OMGSkills-Helper-\d+\.\d+\.\d+-[1-9]\d*-arm64\.dmg$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validateHelperReleaseManifest(value) {
  if (!exactKeys(value, ["version", "enabled", "assets"]) || value.version !== 1
    || typeof value.enabled !== "boolean" || !Array.isArray(value.assets)) {
    throw new Error("Invalid helper release inventory: expected version 1, enabled and assets");
  }
  const seen = new Set();
  const assets = value.assets.map((asset) => {
    if (!exactKeys(asset, ["path", "size", "sha256"]) || typeof asset.path !== "string"
      || (asset.path !== feedPath && !dmgPathPattern.test(asset.path))
      || !Number.isSafeInteger(asset.size) || asset.size <= 0
      || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error("Invalid helper release asset: expected a fixed helper path, positive size and SHA256");
    }
    const key = asset.path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate helper release asset: ${asset.path}`);
    seen.add(key);
    return Object.freeze({ ...asset });
  });
  if (value.enabled ? !seen.has(feedPath) || assets.length < 2 : assets.length !== 0) {
    throw new Error("Helper release inventory must be empty when disabled, or contain the feed and DMGs when enabled");
  }
  return Object.freeze({ version: 1, enabled: value.enabled, assets: Object.freeze(assets) });
}

export async function loadHelperReleaseManifest(file = manifestUrl) {
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read helper release inventory: ${error.message}`);
  }
  return validateHelperReleaseManifest(value);
}

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function inspectDirectory(rootDir, manifest, { create = false } = {}) {
  let directory = await realpath(rootDir);
  for (const part of updateDirectory.split("/")) {
    directory = path.join(directory, part);
    let info = await statIfPresent(directory);
    if (!info && create) {
      await mkdir(directory);
      info = await lstat(directory);
    }
    if (!info) return null;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Unsafe helper release directory: ${directory}`);
    }
  }
  const allowed = new Set(manifest.assets.map((asset) => path.posix.basename(asset.path)));
  for (const name of await readdir(directory)) {
    if (!allowed.has(name)) throw new Error(`Unexpected helper release file: ${name}`);
    const info = await lstat(path.join(directory, name));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Unsafe helper release file: ${name}`);
    }
  }
  return directory;
}

async function verifyBytes(source, asset, destination) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > asset.size) throw new Error(`Helper release size mismatch: ${asset.path}`);
    hash.update(chunk);
    if (destination) await destination.writeFile(chunk);
  }
  if (size !== asset.size) throw new Error(`Helper release size mismatch: ${asset.path}`);
  if (hash.digest("hex") !== asset.sha256) {
    throw new Error(`Helper release checksum mismatch: ${asset.path}`);
  }
}

async function verifyFile(file, asset) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Unsafe helper release file: ${asset.path}`);
  }
  if (info.size !== asset.size) throw new Error(`Helper release size mismatch: ${asset.path}`);
  await verifyBytes(createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), asset);
}

async function fetchAsset(origin, asset, fetchImpl) {
  const response = await fetchImpl(`${origin}/${asset.path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
    headers: { "Accept-Encoding": "identity" },
  });
  const length = response.headers.get("content-length");
  if (response.status !== 200 || !response.body || response.redirected
    || (length !== null && length !== String(asset.size))) {
    await response.body?.cancel();
    throw new Error(`Cannot fetch helper release asset ${asset.path}: HTTP ${response.status} or invalid length/redirect`);
  }
  return response.body;
}

export async function verifyHelperReleaseAssets(rootDir, {
  manifest,
  allowRestore = false,
  fetchImpl = fetch,
} = {}) {
  const reviewed = manifest === undefined
    ? await loadHelperReleaseManifest() : validateHelperReleaseManifest(manifest);
  let directory = await inspectDirectory(rootDir, reviewed);
  const missing = [];
  // Validate every existing file before restoring anything; corruption is never repaired silently.
  for (const asset of reviewed.assets) {
    const file = directory && path.join(directory, path.posix.basename(asset.path));
    if (!file || !(await statIfPresent(file))) missing.push(asset);
    else await verifyFile(file, asset);
  }
  if (missing.length && !allowRestore) {
    throw new Error(`Missing helper release assets: ${missing.map((asset) => asset.path).join(", ")}`);
  }
  if (missing.length) {
    directory = await inspectDirectory(rootDir, reviewed, { create: true });
    const staging = await mkdtemp(path.join(directory, ".restore-"));
    try {
      // Stage and verify the entire missing set before adding any files to the deploy source.
      for (const asset of missing) {
        const stagedPath = path.join(staging, path.posix.basename(asset.path));
        const file = await open(stagedPath, "wx", 0o644);
        try {
          await verifyBytes(await fetchAsset(productionOrigin, asset, fetchImpl), asset, file);
        } finally {
          await file.close();
        }
      }
      for (const asset of missing) {
        const name = path.posix.basename(asset.path);
        // A hard link publishes atomically and refuses an existing destination, unlike rename.
        await link(path.join(staging, name), path.join(directory, name));
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await verifyHelperReleaseAssets(rootDir, { manifest: reviewed });
  }
  return reviewed.assets.map((asset) => asset.path);
}

export async function verifyLiveHelperReleaseAssets({ origin = productionOrigin, manifest, fetchImpl = fetch } = {}) {
  const reviewed = manifest === undefined
    ? await loadHelperReleaseManifest() : validateHelperReleaseManifest(manifest);
  if (!reviewed.enabled) return;
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Helper release verification requires an HTTPS origin without credentials or a path");
  }
  for (const asset of reviewed.assets) {
    await verifyBytes(await fetchAsset(parsed.origin, asset, fetchImpl), asset);
  }
}
