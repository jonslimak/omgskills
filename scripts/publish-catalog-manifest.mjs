import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function referencedAssets(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Invalid catalog manifest");
  }
  return Object.values(manifest).filter((value) => value && typeof value === "object" && "path" in value);
}

function validateAssets(dataDir, assets) {
  for (const asset of assets) {
    if (typeof asset.path !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(asset.path)) {
      throw new Error(`Unsafe catalog asset path: ${asset.path}`);
    }
    const path = join(dataDir, asset.path);
    if (!lstatSync(path).isFile()) throw new Error(`Catalog asset is not a regular file: ${asset.path}`);
    const data = readFileSync(path);
    if (asset.bytes !== undefined && data.length !== asset.bytes) {
      throw new Error(`Catalog asset byte count mismatch: ${asset.path}`);
    }
    if (asset.sha256 !== undefined && createHash("sha256").update(data).digest("hex") !== asset.sha256) {
      throw new Error(`Catalog asset hash mismatch: ${asset.path}`);
    }
  }
}

export function publishCatalogManifest({ dataDir, manifest, previousManifest, prefixes }) {
  const currentAssets = referencedAssets(manifest);
  const previousAssets = referencedAssets(previousManifest);
  // Validate both generations before activating the new manifest or deleting anything.
  validateAssets(dataDir, currentAssets);
  validateAssets(dataDir, previousAssets);
  const currentPaths = new Set(currentAssets.map((asset) => asset.path));
  const previousPaths = new Set(previousAssets.map((asset) => asset.path));
  const keepPaths = new Set([...currentPaths, ...previousPaths]);
  const files = readdirSync(dataDir);
  const deletions = new Set();
  for (const prefix of prefixes) {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(prefix)) throw new Error(`Invalid asset prefix: ${prefix}`);
    const pattern = new RegExp(`^${prefix}-[a-f0-9]{12}\\.json$`);
    const current = [...currentPaths].filter((path) => pattern.test(path)).sort();
    const previous = [...previousPaths].filter((path) => pattern.test(path)).sort();
    // No-op publishing must not erase the retained prior generation. On first use,
    // leave unknown history alone until this prefix actually changes.
    if (previous.length === 0 || JSON.stringify(current) === JSON.stringify(previous)) continue;
    for (const file of files) {
      if (pattern.test(file) && !keepPaths.has(file)) deletions.add(file);
    }
  }

  const manifestPath = join(dataDir, "manifest.json");
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, manifestPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  for (const file of deletions) rmSync(join(dataDir, file));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dataDir, candidatePath, previousPath, ...prefixes] = process.argv.slice(2);
  if (!dataDir || !candidatePath || !previousPath || prefixes.length === 0) {
    throw new Error("Usage: publish-catalog-manifest.mjs <data-dir> <candidate> <previous> <prefix>...");
  }
  const previous = readFileSync(previousPath, "utf8");
  publishCatalogManifest({
    dataDir,
    manifest: JSON.parse(readFileSync(candidatePath, "utf8")),
    previousManifest: previous.trim() ? JSON.parse(previous) : {},
    prefixes,
  });
}
