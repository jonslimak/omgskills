import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import { isCloudSaveAvailable } from "./_shared/cloud-save.js";
import { createCloudObjectStore, type CloudObjectStore } from "./_shared/cloud-store.js";
import { getPgPool } from "./_shared/db.js";
import { getEnv } from "./_shared/env.js";
import { GithubImportError } from "./_shared/github-skill-import.js";
import { saveGithubSkill, skillPreview } from "./_shared/github-skill-save.js";
import { optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { MAX_UPLOAD_BYTES, readUploadedSkill, uploadTooLarge } from "./_shared/skill-upload.js";
import { requirePortalUser } from "./_shared/user.js";

// "Add skill" from a folder on the person's computer.
// POST form (folder, paths, file…)            reads the skill and shows what would be added (and anything that stops it).
// POST the same form with add=1               adds it to My skills.

export type PortalUploadSkillDependencies = {
  available(): boolean;
  pool(): Pool;
  store(): CloudObjectStore;
  requireUserId(req: Request): Promise<string>;
};

const defaults: PortalUploadSkillDependencies = {
  available: () => isCloudSaveAvailable(getEnv),
  pool: getPgPool,
  store: () => createCloudObjectStore(),
  async requireUserId(req) { return (await requirePortalUser(req)).id; },
};

/** Room for the form's boundaries and the paths list on top of the files. */
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;

export async function portalUploadSkill(req: Request, dependencies: PortalUploadSkillDependencies = defaults): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  try {
    const userId = await dependencies.requireUserId(req);
    if (!dependencies.available()) throw new GithubImportError("unavailable", "Adding skills isn't available yet.", 503);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw uploadTooLarge();
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      throw new GithubImportError("invalid_link", "The folder couldn't be read. Choose it again.", 400);
    }
    let form: FormData;
    try { form = await req.formData(); } catch {
      throw new GithubImportError("invalid_link", "The folder couldn't be read. Choose it again.", 400);
    }
    const skill = await readUploadedSkill(form);
    const pool = dependencies.pool();
    if (form.get("add") !== "1") return secretJsonResponse(req, await skillPreview(pool, userId, skill));
    return secretJsonResponse(req, { skill: await saveGithubSkill(pool, dependencies.store(), userId, skill) });
  } catch (error) {
    if (error instanceof GithubImportError) {
      return secretJsonResponse(req, { error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Response) return secretJsonResponse(req, { error: await error.text() }, { status: error.status });
    console.error("skill upload failed", error instanceof Error ? error.name : "unknown");
    return secretJsonResponse(req, { error: "The skill couldn't be added. Try again." }, { status: 500 });
  }
}

export default (req: Request, _context: Context) => portalUploadSkill(req);

export const config: Config = {
  path: "/api/portal/upload-skill",
  rateLimit: { action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 30, windowSize: 60 },
};
