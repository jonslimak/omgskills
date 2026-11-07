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
];

/** A readable name for an OAuth client: the agent for known hosts, else the host; IDs that aren't URLs say "Agent". */
export function agentName(clientId: string): string {
  try {
    const url = new URL(clientId);
    if (url.protocol !== "https:") return "Agent";
    const host = url.hostname.toLowerCase();
    const known = knownAgents.find(([pattern]) => pattern.test(host));
    if (!known) return host;
    // Claude Code and Claude (web/desktop) share a host; their metadata path tells them apart.
    return known[1] === "Claude" && /claude-code/i.test(url.pathname) ? "Claude Code" : known[1];
  } catch {
    return "Agent";
  }
}

/** Records that this agent used My skills now and says whether it's blocked. One write per request. */
export async function touchAgent(db: Database, userId: string, clientId: string): Promise<{ blocked: boolean }> {
  const id = clientId.slice(0, MAX_CLIENT_ID_LENGTH) || "unknown";
  const result = await db.query<{ blocked: boolean }>(
    `
      INSERT INTO library_agent_connections (user_id, client_id) VALUES ($1, $2)
      ON CONFLICT (user_id, client_id) DO UPDATE SET last_used_at = now()
      RETURNING blocked_at IS NOT NULL AS blocked
    `,
    [userId, id],
  );
  return { blocked: result.rows[0]?.blocked === true };
}

export type LibraryAgent = { clientId: string; name: string; firstUsedAt: string; lastUsedAt: string; blocked: boolean };

export async function listAgents(db: Database, userId: string): Promise<LibraryAgent[]> {
  const result = await db.query<{ clientId: string; firstUsedAt: Date | string; lastUsedAt: Date | string; blocked: boolean }>(
    `
      SELECT client_id AS "clientId", first_used_at AS "firstUsedAt", last_used_at AS "lastUsedAt",
        blocked_at IS NOT NULL AS blocked
      FROM library_agent_connections WHERE user_id = $1
      ORDER BY last_used_at DESC, client_id
    `,
    [userId],
  );
  return result.rows.map(row => ({ clientId: row.clientId, name: agentName(row.clientId),
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
