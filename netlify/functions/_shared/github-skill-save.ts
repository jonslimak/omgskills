// Saves a skill read from GitHub (github-skill-import.ts) into the person's My skills, as if their Mac had
// synced it: no device, a new key of its own. Their Macs then list it as not installed and can install it.
import type { Pool } from "pg";
import { CloudSaveError, readCloudRecordNames, readCloudSaveSettings, saveCloudVersion, storeCloudBlobs, MAX_BLOB_BATCH_FILES,
  normalizeSkillKey } from "./cloud-save.js";
import type { CloudObjectStore } from "./cloud-store.js";
import { candidateKey, cloudNameKey } from "./cloud-skill-keys.js";
import { GithubImportError, manifestOf, type GithubSkill } from "./github-skill-import.js";

/** The first free key for the skill: its folder name, then "<folder>@agents", "@agents-2", … */
export function githubSkillKey(skill: Pick<GithubSkill, "folder" | "repo" | "name">, taken: Set<string>): string {
  const folder = cloudNameKey(skill.folder.split("/").filter(Boolean).at(-1) ?? skill.repo.split("/")[1] ?? skill.name);
  let base = folder;
  try { normalizeSkillKey(base); } catch { base = cloudNameKey(skill.name).replace(/[/\\]/g, "-").replace(/^\.+/, "") || "skill"; }
  for (let index = 0; ; index += 1) {
    const key = candidateKey(base, "agents", index);
    if (!taken.has(key)) return key;
  }
}

// Refusals use 409, never 403: the web treats 403 as lost access.
export async function saveGithubSkill(pool: Pool, store: CloudObjectStore, userId: string, skill: GithubSkill) {
  const settings = await readCloudSaveSettings(pool, userId);
  if (!settings.enabled) {
    throw new GithubImportError("sync_off", "Sync is off. Turn on Sync My skills (menu → Sync) to add skills from GitHub.", 409);
  }
  const records = await readCloudRecordNames(pool, userId);
  const name = cloudNameKey(skill.name);
  if (records.some(record => record.name === name)) {
    throw new GithubImportError("already_added", `You already have a skill named "${skill.name}" in My skills.`, 409);
  }
  const key = githubSkillKey(skill, new Set([...records.map(record => record.key), ...settings.excludedSkillKeys]));
  try {
    for (let start = 0; start < skill.files.length; start += MAX_BLOB_BATCH_FILES) {
      const results = await storeCloudBlobs(pool, store, { userId, deviceId: null,
        files: skill.files.slice(start, start + MAX_BLOB_BATCH_FILES).map(({ blobSha, data }) => ({ blobSha, data })) });
      // The import already refused files that look like secrets; the store's own scan agrees, so this is a backstop.
      if (results.some(result => result.status === "needs_review")) {
        throw new GithubImportError("secret", "A file looks like it holds a password or key, so the skill wasn't added.");
      }
    }
    const saved = await saveCloudVersion(pool, { userId, deviceId: null, skillKey: key, files: manifestOf(skill.files), skillName: skill.name });
    if (saved.status !== "saved") throw new GithubImportError("unavailable", "The skill couldn't be saved. Try again.", 503);
    return { key: saved.skill.key, name: skill.name };
  } catch (error) {
    if (!(error instanceof CloudSaveError)) throw error;
    const messages: Partial<Record<CloudSaveError["code"], [string, number]>> = {
      disabled: ["Sync is off. Turn on Sync My skills (menu → Sync) to add skills from GitHub.", 409],
      quota_exceeded: ["Your My skills storage is full (1 GB). Delete some synced skills, then try again.", 413],
      file_too_large: ["A file in this skill is too big to save.", 413],
      invalid_package: ["This skill's files can't be saved.", 422],
      name_taken: ["Another skill already uses this folder name. Try again.", 409],
      needs_review: ["A file looks like it holds a password or key, so the skill wasn't added.", 422],
    };
    const known = messages[error.code];
    throw new GithubImportError(error.code === "disabled" ? "sync_off" : "unavailable",
      known?.[0] ?? "The skill couldn't be saved. Try again.", known?.[1] ?? 503);
  }
}
