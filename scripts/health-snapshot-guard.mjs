import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const HEALTH_SNAPSHOT_PATH = "data/health.json";

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export function parseHealthSnapshot(raw, source = HEALTH_SNAPSHOT_PATH) {
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid health snapshot JSON: ${source}`);
  }

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`Invalid health snapshot object: ${source}`);
  }
  if (typeof snapshot.status !== "string" || snapshot.status.trim() === "") {
    throw new Error(`Health snapshot is missing status: ${source}`);
  }
  if (!snapshot.sections || typeof snapshot.sections !== "object" || Array.isArray(snapshot.sections)) {
    throw new Error(`Health snapshot is missing sections: ${source}`);
  }

  return snapshot;
}

export async function ensureHealthSnapshot({
  siteDir,
  productionOrigin = "https://omgskills.com",
  fetchImpl = fetch,
}) {
  const target = path.join(siteDir, HEALTH_SNAPSHOT_PATH);
  if (await fileExists(target)) {
    parseHealthSnapshot(await readFile(target, "utf8"), target);
    return { restored: false, target };
  }

  const source = `${productionOrigin.replace(/\/$/, "")}/${HEALTH_SNAPSHOT_PATH}`;
  const response = await fetchImpl(source);
  if (!response.ok) {
    throw new Error(`Failed to preserve health snapshot: ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  parseHealthSnapshot(raw, source);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, raw);
  return { restored: true, source, target };
}
