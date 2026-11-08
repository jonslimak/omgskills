// Saves a skill read from GitHub (github-skill-import.ts) into the person's My skills, as if their Mac had
// synced it: no device, a new key of its own. Their Macs then list it as not installed and can install it.
import type { Pool } from "pg";
import { CloudSaveError, readCloudRecordNames, readCloudSaveSettings, saveCloudVersion, storeCloudBlobs, MAX_BLOB_BATCH_FILES,
  normalizeSkillKey } from "./cloud-save.js";
import type { CloudObjectStore } from "./cloud-store.js";
import { candidateKey, cloudNameKey } from "./cloud-skill-keys.js";
import { GithubImportError, manifestOf, type GithubSkill } from "./github-skill-import.js";

/** The first free key for the skill: its folder name, then "<folder>@agents", "@agents-2", …; null when none is valid. */
export function githubSkillKey(skill: Pick<GithubSkill, "folder" | "repo" | "name">, taken: Set<string>): string | null {
  const valid = (key: string) => { try { return normalizeSkillKey(key) === key; } catch { return false; } };
  const folder = cloudNameKey(skill.folder.split("/").filter(Boolean).at(-1) ?? skill.repo.split("/")[1] ?? skill.name);
  const named = cloudNameKey(skill.name).replace(/[/\\]/g, "-").replace(/^\.+/, "").trim();
  const base = [folder, named].find(candidate => candidate && valid(candidate) && valid(candidateKey(candidate, "agents", 1)));
  if (!base) return null;
  for (let index = 0; index < 1000; index += 1) {
    const key = candidateKey(base, "agents", index);
    if (!taken.has(key)) return key;
  }
  return null;
}

const SYNC_OFF = "Sync is off. Turn on Sync My skills (menu → Sync) to add skills from GitHub.";

// Refusals use 409, never 403: the web treats 403 as lost access.
export async function saveGithubSkill(pool: Pool, store: CloudObjectStore, userId: string, skill: GithubSkill) {
  const settings = await readCloudSaveSettings(pool, userId);
  if (!settings.enabled) throw new GithubImportError("sync_off", SYNC_OFF, 409);
  const records = await readCloudRecordNames(pool, userId);
  const name = cloudNameKey(skill.name);
  const alreadyAdded = () => new GithubImportError("already_added", `You already have a skill named "${skill.name}" in My skills.`, 409);
  if (records.some(record => record.name === name)) throw alreadyAdded();
  // Keys held by saved skills, skills left out of sync, and Mac saves waiting for review are all taken.
  const reviews = await pool.query<{ key: string }>("SELECT skill_key AS key FROM cloud_skill_reviews WHERE user_id = $1", [userId]);
  const taken = new Set([...records.map(record => record.key), ...settings.excludedSkillKeys, ...reviews.rows.map(row => row.key)]);
  try {
    for (let start = 0; start < skill.files.length; start += MAX_BLOB_BATCH_FILES) {
      const results = await storeCloudBlobs(pool, store, { userId, deviceId: null,
        files: skill.files.slice(start, start + MAX_BLOB_BATCH_FILES).map(({ blobSha, data }) => ({ blobSha, data })) });
      // The import already refused files that look like secrets; the store's own scan agrees, so this is a backstop.
      if (results.some(result => result.status === "needs_review")) {
        throw new GithubImportError("secret", "A file looks like it holds a password or key, so the skill wasn't added.");
      }
    }
    // Another add can take the chosen key first; then the next free key is tried.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = githubSkillKey(skill, taken);
      if (!key) throw new GithubImportError("unsupported_file", "This skill's folder name can't be used as a skill name.", 422);
      try {
        const saved = await saveCloudVersion(pool, { userId, deviceId: null, skillKey: key, files: manifestOf(skill.files), skillName: skill.name,
          skillDescription: skill.description });
        if (saved.status !== "saved") throw new GithubImportError("unavailable", "The skill couldn't be saved. Try again.", 503);
        return { key: saved.skill.key, name: skill.name };
      } catch (error) {
        if (!(error instanceof CloudSaveError && error.code === "name_taken")) throw error;
        // The key was taken meanwhile: by this same skill (a second tab or click), or by another one.
        if ((await readCloudRecordNames(pool, userId)).some(record => record.name === name)) throw alreadyAdded();
        taken.add(key);
      }
    }
    throw new GithubImportError("unavailable", "The skill couldn't be saved. Try again.", 503);
  } catch (error) {
    if (!(error instanceof CloudSaveError)) throw error;
    const messages: Partial<Record<CloudSaveError["code"], [string, number]>> = {
      disabled: [SYNC_OFF, 409],
      quota_exceeded: ["Your My skills storage is full (1 GB). Delete some synced skills, then try again.", 413],
      file_too_large: ["A file in this skill is too big to save.", 413],
      invalid_package: ["This skill's files can't be saved.", 422],
      invalid_skill_key: ["This skill's folder name can't be used as a skill name.", 422],
      needs_review: ["A file looks like it holds a password or key, so the skill wasn't added.", 422],
    };
    const known = messages[error.code];
    throw new GithubImportError(error.code === "disabled" ? "sync_off" : "unavailable",
      known?.[0] ?? "The skill couldn't be saved. Try again.", known?.[1] ?? 503);
  }
}
