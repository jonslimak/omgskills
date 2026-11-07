import type { Config } from "@netlify/functions";
import featureConfig from "../../config/production-features.json" with { type: "json" };
import { validateProductionFeatures } from "../../config/production-features.mjs";
import { readSkillContent } from "../../mcp/src/content.js";
import { inspectSkillFiles } from "../../mcp/src/file-inspection.js";
import type { SkillResult } from "../../mcp/src/library.js";
import type { SyncedSkill } from "../../portal/src/synced-skill-grouping.js";
import { readCloudSave } from "./_shared/cloud-save.js";
import { createCloudObjectStore } from "./_shared/cloud-store.js";
import { createCompactMcpLibraryLoader } from "./_shared/compact-mcp-library.js";
import { getPgPool } from "./_shared/db.js";
import { getEnv } from "./_shared/env.js";
import { withTimeout } from "./_shared/http.js";
import { handleLibraryMcp, issuerFromPublishableKey, type LibraryMcpDependencies, type VerifiedToken } from "./_shared/library-mcp.js";
import { listSavedFiles, readSavedFile } from "./_shared/library-read.js";
import { registeredAgentName, touchAgent } from "./_shared/library-agents.js";
import { loadProductionMcpLibrary } from "./_shared/mcp-library.js";
import { loadMySkills, type CatalogDetails } from "./_shared/my-skills-library.js";
import { readSyncInventory } from "./_shared/sync-inventory-read.js";

const catalog = validateProductionFeatures(featureConfig).catalogSearchEnabled
  ? createCompactMcpLibraryLoader({ ranking: true }) : loadProductionMcpLibrary;

async function publicSkill(id: string): Promise<SkillResult | undefined> {
  const { library } = await catalog.get();
  return (await library.getSkill(id)) ?? undefined;
}

/** Asks Clerk about an OAuth access token; its answer includes the audience, which the SDK in use drops. */
async function verifyToken(token: string): Promise<VerifiedToken | null> {
  const secret = getEnv("CLERK_SECRET_KEY");
  if (!secret) throw new Error("Missing Clerk server configuration");
  const response = await fetch("https://api.clerk.com/v1/oauth_applications/access_tokens/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 400 || response.status === 401 || response.status === 404 || response.status === 422) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) throw new Error(`Clerk verify ${response.status}`);
  const body = await response.json() as { subject?: unknown; aud?: unknown; revoked?: unknown; expired?: unknown; client_id?: unknown };
  if (typeof body.subject !== "string") return null;
  const aud = typeof body.aud === "string" ? [body.aud] : Array.isArray(body.aud) ? body.aud.filter((a): a is string => typeof a === "string") : [];
  return { subject: body.subject, aud, revoked: body.revoked === true, expired: body.expired === true,
    clientId: typeof body.client_id === "string" ? body.client_id : undefined };
}

const LOOKUP_RETRY_MS = 10 * 60_000;
const lookups = new Map<string, Promise<string | null>>();
const failedLookups = new Map<string, number>();

/**
 * The name of an agent that registered itself with Clerk (DCR). Clerk has no lookup by client ID,
 * so this scans the newest apps; it runs once per person and agent. One scan at a time per client,
 * and after a failure it waits before trying again so a Clerk outage doesn't slow every request.
 */
function describeClient(clientId: string): Promise<string | null> {
  if ((failedLookups.get(clientId) ?? 0) > Date.now()) return Promise.reject(new Error("Recently failed"));
  const running = lookups.get(clientId);
  if (running) return running;
  const lookup = scanClerkApps(clientId)
    .catch(error => {
      if (failedLookups.size > 1_000) failedLookups.clear();
      failedLookups.set(clientId, Date.now() + LOOKUP_RETRY_MS);
      throw error;
    })
    .finally(() => lookups.delete(clientId));
  lookups.set(clientId, lookup);
  return lookup;
}

async function scanClerkApps(clientId: string): Promise<string | null> {
  const secret = getEnv("CLERK_SECRET_KEY");
  if (!secret) throw new Error("Missing Clerk server configuration");
  const signal = AbortSignal.timeout(4_000);
  for (let offset = 0; offset < 500; offset += 100) {
    const response = await fetch(`https://api.clerk.com/v1/oauth_applications?limit=100&offset=${offset}&order_by=-created_at`,
      { headers: { Authorization: `Bearer ${secret}` }, signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Clerk apps ${response.status}`); }
    const body = await response.json() as { data?: { client_id?: unknown; name?: unknown; redirect_uris?: unknown }[] };
    const apps = Array.isArray(body.data) ? body.data : [];
    const app = apps.find(item => item?.client_id === clientId);
    if (app) {
      return registeredAgentName({
        name: typeof app.name === "string" ? app.name : null,
        redirectUris: Array.isArray(app.redirect_uris) ? app.redirect_uris.filter((u): u is string => typeof u === "string") : [],
      }) || null;
    }
    if (apps.length < 100) return null;
  }
  // Too many apps to scan: try again later rather than saving it as unknown.
  throw new Error("Client not in the newest apps");
}

const dependencies: LibraryMcpDependencies = {
  verifyToken,
  userIdFor: async (clerkUserId) => {
    const result = await getPgPool().query<{ id: string }>("SELECT id FROM users WHERE clerk_user_id = $1", [clerkUserId]);
    return result.rows[0]?.id ?? null;
  },
  touchAgent: (userId, clientId) => touchAgent(getPgPool(), userId, clientId, describeClient),
  loadMySkills: (userId) => loadMySkills(userId, {
    readInventory: async (id) => (await readSyncInventory(getPgPool(), id, 3)).skills as unknown as SyncedSkill[],
    readCloud: (id) => readCloudSave(getPgPool(), id),
    readAdditions: async (id) => (await getPgPool().query<{ id: string }>(
      "SELECT catalog_skill_id AS id FROM my_skill_additions WHERE user_id = $1 ORDER BY added_at DESC", [id])).rows.map(row => row.id),
    catalogDetails: (ids) => withTimeout((async () => {
      const details = new Map<string, CatalogDetails>();
      for (const id of ids) {
        const skill = await publicSkill(id);
        if (skill) details.set(id, { name: skill.name, description: skill.description, author: skill.author_handle, githubUrl: skill.github_url });
      }
      return details;
    })(), 4_000),
  }),
  savedFiles: (userId, key) => listSavedFiles(getPgPool(), userId, key),
  readSaved: (userId, file) => readSavedFile(createCloudObjectStore(), userId, file),
  publicSkill,
  readPublicSkillMd: (skill, maxChars) => readSkillContent(skill, maxChars),
  readPublicFile: (skill, path) => inspectSkillFiles(skill, { max_files: 1, max_chars: 8000, paths: [path] }),
  issuer: () => getEnv("CLERK_OAUTH_ISSUER")
    ?? issuerFromPublishableKey(getEnv("CLERK_PUBLISHABLE_KEY") ?? getEnv("VITE_CLERK_PUBLISHABLE_KEY")),
};

export default async (req: Request): Promise<Response> => {
  // Off until sign-in is set up for this site.
  if (getEnv("LIBRARY_MCP_ENABLED") !== "1") return new Response("Not found", { status: 404 });
  return handleLibraryMcp(req, dependencies);
};

export const config: Config = {
  path: ["/api/library/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/library/mcp",
    "/.well-known/oauth-authorization-server"],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
