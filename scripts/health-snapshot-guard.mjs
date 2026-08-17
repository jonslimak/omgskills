import { readFile, stat } from "node:fs/promises";
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
}) {
  const target = path.join(siteDir, HEALTH_SNAPSHOT_PATH);
  if (await fileExists(target)) {
    parseHealthSnapshot(await readFile(target, "utf8"), target);
    return { restored: false, target };
  }
  throw new Error(
    `Missing required health snapshot: ${target}. Restore a pipeline-health artifact before preparing the deploy.`,
  );
}
