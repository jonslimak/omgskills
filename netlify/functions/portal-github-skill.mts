import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import { isCloudSaveAvailable, readCloudRecordNames, readCloudSaveSettings } from "./_shared/cloud-save.js";
import { cloudNameKey } from "./_shared/cloud-skill-keys.js";
import { createCloudObjectStore, type CloudObjectStore } from "./_shared/cloud-store.js";
import { getPgPool } from "./_shared/db.js";
import { getEnv } from "./_shared/env.js";
import { GithubImportError, parseGithubImportLink, readGithubSkill, type GithubImportOptions, type GithubSkill } from "./_shared/github-skill-import.js";
import { saveGithubSkill } from "./_shared/github-skill-save.js";
import { optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { requireJsonObject } from "./_shared/validation.js";

// "Add skill" for a GitHub skill that isn't in the library.
// GET ?link=  reads the skill and shows what would be added (and anything that stops it).
// POST {link, commitSha, folder}  adds exactly that version to My skills.

export type PortalGithubSkillDependencies = {
  available(): boolean;
  pool(): Pool;
  store(): CloudObjectStore;
  requireUserId(req: Request): Promise<string>;
  github: GithubImportOptions;
};

const defaults: PortalGithubSkillDependencies = {
  available: () => isCloudSaveAvailable(getEnv),
  pool: getPgPool,
  store: () => createCloudObjectStore(),
  async requireUserId(req) { return (await requirePortalUser(req)).id; },
  github: {},
};

const MAX_SKILL_MD_CHARS = 20_000;
const MAX_LISTED_FILES = 100;
const SYNC_OFF = "Sync is off. Turn on Sync My skills (menu → Sync) to add skills from GitHub.";

function preview(skill: GithubSkill, blocker: string | null) {
  return {
    repo: skill.repo, commitSha: skill.commitSha, folder: skill.folder, name: skill.name, description: skill.description,
    skillMd: skill.skillMd.slice(0, MAX_SKILL_MD_CHARS), skillMdTruncated: skill.skillMd.length > MAX_SKILL_MD_CHARS,
    labels: skill.labels, fileCount: skill.files.length, totalBytes: skill.totalBytes,
    files: skill.files.slice(0, MAX_LISTED_FILES).map(file => ({ path: file.path, bytes: file.data.byteLength })),
    blocker,
  };
}

function link(value: unknown) {
  const parsed = typeof value === "string" ? parseGithubImportLink(value) : null;
  if (!parsed) throw new GithubImportError("invalid_link", "Paste a link to a GitHub repo, folder or SKILL.md.", 400);
  return parsed;
}

export async function portalGithubSkill(req: Request, dependencies: PortalGithubSkillDependencies = defaults): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET" && req.method !== "POST") return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  try {
    const userId = await dependencies.requireUserId(req);
    if (!dependencies.available()) {
      throw new GithubImportError("unavailable", "Adding skills from GitHub isn't available yet.", 503);
    }
    const pool = dependencies.pool();
    if (req.method === "GET") {
      // Netlify stops a function after about 10 seconds; GitHub gets 8 of them, so a slow read still gets its reason.
      const skill = await readGithubSkill(link(new URL(req.url).searchParams.get("link")), { deadline: Date.now() + 8_000, ...dependencies.github });
      const [settings, records] = await Promise.all([readCloudSaveSettings(pool, userId), readCloudRecordNames(pool, userId)]);
      const blocker = !settings.enabled ? SYNC_OFF
        : records.some(record => record.name === cloudNameKey(skill.name)) ? `You already have a skill named "${skill.name}" in My skills.`
        : null;
      return secretJsonResponse(req, preview(skill, blocker));
    }
    const body = await requireJsonObject(req);
    const raw = body.folder;
    const folder = raw === "" ? "" : typeof raw === "string" && raw.length <= 500
      && raw.split("/").every(part => part && part !== "." && part !== ".." && !part.includes("\\")) ? raw : null;
    if (folder === null || typeof body.commitSha !== "string") {
      throw new GithubImportError("invalid_link", "Find the skill again, then add it.", 400);
    }
    // Saving needs time after the read, so the read gets less here.
    const skill = await readGithubSkill(link(body.link), { deadline: Date.now() + 6_000, ...dependencies.github, pinned: { commitSha: body.commitSha, folder } });
    return secretJsonResponse(req, { skill: await saveGithubSkill(pool, dependencies.store(), userId, skill) });
  } catch (error) {
    if (error instanceof GithubImportError) {
      return secretJsonResponse(req, { error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Response) return secretJsonResponse(req, { error: await error.text() }, { status: error.status });
    console.error("github skill import failed", error instanceof Error ? error.name : "unknown");
    return secretJsonResponse(req, { error: "The skill couldn't be added. Try again." }, { status: 500 });
  }
}

export default (req: Request, _context: Context) => portalGithubSkill(req);

export const config: Config = {
  path: "/api/portal/github-skill",
  rateLimit: { action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 30, windowSize: 60 },
};
