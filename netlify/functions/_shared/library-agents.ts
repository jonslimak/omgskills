// Agents connected to My skills (the library MCP), as the person sees them in the account menu.
// The MCP records each agent when it signs in; Disconnect blocks it until the person allows it again.
import { getPgPool } from "./db.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./http.js";
import { requirePortalUser } from "./user.js";
import { requireJsonObject, requireString } from "./validation.js";

type Database = { query: <Row = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: Row[] }> };

export const MAX_CLIENT_ID_LENGTH = 500;

const knownAgents: [RegExp, string][] = [
  [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, "Claude"],
  [/(^|\.)grok\.com$|(^|\.)x\.ai$|(^|\.)x\.com$/, "Grok"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)cursor\.(com|sh)$/, "Cursor"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)meta\.ai$|(^|\.)meta\.com$/, "Meta AI"],
];

const hostOf = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/** A readable name for an OAuth client: the agent for known hosts, else the host; IDs that aren't URLs say "Agent". */
export function agentName(clientId: string): string {
  const host = hostOf(clientId);
  if (!host) return "Agent";
  const known = knownAgents.find(([pattern]) => pattern.test(host));
  if (!known) return host;
  // Claude Code and Claude (web/desktop) share a host; their metadata path tells them apart.
  return known[1] === "Claude" && /claude-code/i.test(new URL(clientId).pathname) ? "Claude Code" : known[1];
}

export type RegisteredClient = { name?: string | null; redirectUris?: string[] };

const LOCAL = "this computer";
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

/**
 * A name for a client that registered itself (DCR). Its name and client_uri are self-chosen, so a known
 * agent is recognized only when every sign-in (redirect) address is https on that agent's host; any other
 * name is shown with the address sign-ins go to, or "this computer" for local and app redirects.
 */
export function registeredAgentName(client: RegisteredClient): string {
  const where = (client.redirectUris ?? []).map(uri => hostOf(uri) ?? LOCAL);
  const known = where.length > 0 && knownAgents.find(([pattern]) => where.every(host => pattern.test(host)));
  if (known) return known[1];
  const name = (client.name ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, 60);
  // Show the address that isn't a known agent's, so a borrowed name can't hide where sign-ins go.
  const shown = where.find(host => !knownAgents.some(([pattern]) => pattern.test(host))) ?? where[0];
  if (name && shown) return `${name} (${shown})`;
  return name || shown || "";
}

/**
 * Records that this agent used My skills now and says whether it's blocked. One write per request,
 * plus, the first time only, the name of a self-registered client (its ID isn't a URL) via `describe`.
 */
export async function touchAgent(db: Database, userId: string, clientId: string,
  describe?: (clientId: string) => Promise<string | null>): Promise<{ blocked: boolean }> {
  const id = clientId.slice(0, MAX_CLIENT_ID_LENGTH) || "unknown";
  const upsert = (returning: string) => db.query<{ blocked: boolean; unnamed?: boolean }>(
    `
      INSERT INTO library_agent_connections (user_id, client_id) VALUES ($1, $2)
      ON CONFLICT (user_id, client_id) DO UPDATE SET last_used_at = now()
      RETURNING ${returning}
    `,
    [userId, id],
  );
  // Until the client_name column exists (a deploy before its migration), work as before without names.
  const result = await upsert("blocked_at IS NOT NULL AS blocked, client_name IS NULL AS unnamed").catch(error => {
    if ((error as { code?: string })?.code === "42703") return upsert("blocked_at IS NOT NULL AS blocked");
    throw error;
  });
  const row = result.rows[0];
  if (describe && row?.unnamed === true && id !== "unknown" && !hostOf(id)) {
    // Best effort: an unknown client is saved as '' so it isn't looked up again; a failed lookup retries next time.
    const name = await describe(id).then(found => (found ?? "").slice(0, 200), () => null);
    if (name !== null) await db.query(
      "UPDATE library_agent_connections SET client_name = $3 WHERE user_id = $1 AND client_id = $2 AND client_name IS NULL",
      [userId, id, name],
    ).catch(() => undefined);
  }
  return { blocked: row?.blocked === true };
}

export type LibraryAgent = { clientId: string; name: string; firstUsedAt: string; lastUsedAt: string; blocked: boolean };

export async function listAgents(db: Database, userId: string): Promise<LibraryAgent[]> {
  const result = await db.query<{ clientId: string; clientName: string | null; firstUsedAt: Date | string;
    lastUsedAt: Date | string; blocked: boolean }>(
    `
      SELECT client_id AS "clientId", client_name AS "clientName", first_used_at AS "firstUsedAt",
        last_used_at AS "lastUsedAt", blocked_at IS NOT NULL AS blocked
      FROM library_agent_connections WHERE user_id = $1
      ORDER BY last_used_at DESC, client_id
    `,
    [userId],
  );
  return result.rows.map(row => ({ clientId: row.clientId, name: row.clientName || agentName(row.clientId),
    firstUsedAt: new Date(row.firstUsedAt).toISOString(), lastUsedAt: new Date(row.lastUsedAt).toISOString(), blocked: row.blocked }));
}

/** Disconnect (blocked) or allow again. Returns false when this person has no such agent. */
export async function setAgentBlocked(db: Database, userId: string, clientId: string, blocked: boolean): Promise<boolean> {
  const result = await db.query(
    `
      UPDATE library_agent_connections
      SET blocked_at = CASE WHEN $3::boolean THEN coalesce(blocked_at, now()) ELSE NULL END
      WHERE user_id = $1 AND client_id = $2
      RETURNING client_id
    `,
    [userId, clientId, blocked],
  );
  return result.rows.length > 0;
}

const defaultDependencies = { getPgPool: (): Database => getPgPool() as unknown as Database, requirePortalUser };
export type LibraryAgentsDependencies = typeof defaultDependencies;

/** GET lists your connected agents; PUT {clientId, blocked} disconnects one or allows it again. */
export async function handleLibraryAgents(req: Request, overrides: Partial<LibraryAgentsDependencies> = {}): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  const deps = { ...defaultDependencies, ...overrides };
  try {
    if (!["GET", "PUT"].includes(req.method)) return errorResponse(req, 405, "Method not allowed");
    const user = await deps.requirePortalUser(req);
    if (req.method === "GET") return secretJsonResponse(req, { agents: await listAgents(deps.getPgPool(), user.id) });
    const body = await requireJsonObject(req);
    const clientId = requireString(body.clientId, "clientId", MAX_CLIENT_ID_LENGTH);
    if (typeof body.blocked !== "boolean") return errorResponse(req, 400, "blocked must be true or false");
    if (!await setAgentBlocked(deps.getPgPool(), user.id, clientId, body.blocked)) return errorResponse(req, 404, "Agent not found");
    return secretJsonResponse(req, { clientId, blocked: body.blocked });
  } catch (error) {
    if (error instanceof Response) return errorResponse(req, error.status, await error.text());
    return errorResponse(req, 500, "Failed to update connected agents");
  }
}
