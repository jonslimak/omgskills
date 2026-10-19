import type { Context } from "@netlify/functions";
import pg, { type Pool } from "pg";
import { getEnv } from "./env.js";

export const connectedCandidateOrigin = "https://omgskills-setup-test-f3b.netlify.app";
export const connectedCandidateSiteId = "16f435c1-e5d0-4b40-b174-382d839e877b";
export const connectedCandidatePaths = [
  "/api/portal/sync-pairing-code", "/api/portal/sync-exchange", "/api/portal/sync-upload",
  "/api/portal/synced-skills", "/api/portal/device-revoke",
] as const;
const environmentKeys = [
  "OMGSKILLS_CONNECTED_CANDIDATE", "OMGSKILLS_CONNECTED_CANDIDATE_PROFILE",
  "OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL", "OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST",
  "OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME", "OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER",
  "CLERK_SECRET_KEY", "NODE_ENV", "OMGSKILLS_CONNECTED_INVENTORY_TEST",
  "OMGSKILLS_INVENTORY_RECONCILIATION_TEST", "SKILLGROUPS_DATABASE_URL", "NETLIFY_DB_URL",
] as const;
export type CandidateEnvironment = Record<string, string | undefined>;
export type ConnectedCandidateConfiguration = Readonly<{
  connectionString: string;
  database: string;
  user: string;
  secretKey: string;
}>;
export type CandidateRoute = "pair" | "exchange" | "revision" | "upload" | "read" | "revoke";

export function candidateEnvironment(): CandidateEnvironment {
  return Object.fromEntries(environmentKeys.map(key => [key, getEnv(key)]));
}

function unavailable(): Response {
  return new Response("Connected candidate configuration is unavailable", { status: 503 });
}

export function requireConnectedCandidate(req: Request, context: Context, env: CandidateEnvironment): ConnectedCandidateConfiguration {
  const url = new URL(req.url);
  if (context.site?.id !== connectedCandidateSiteId || url.origin !== connectedCandidateOrigin) {
    throw new Response("Not found", { status: 404 });
  }
  if (context.deploy?.context !== "production" || env.OMGSKILLS_CONNECTED_CANDIDATE !== "1"
    || env.OMGSKILLS_CONNECTED_CANDIDATE_PROFILE !== "connected"
    || [env.OMGSKILLS_CONNECTED_INVENTORY_TEST, env.OMGSKILLS_INVENTORY_RECONCILIATION_TEST].some(value => value !== undefined && value !== "0")
    || !/^sk_test_[A-Za-z0-9]+$/.test(env.CLERK_SECRET_KEY ?? "")) throw unavailable();
  try {
    const raw = env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL;
    if (!raw || raw === env.SKILLGROUPS_DATABASE_URL || raw === env.NETLIFY_DB_URL) throw unavailable();
    const db = new URL(raw);
    const database = decodeURIComponent(db.pathname.slice(1));
    const user = decodeURIComponent(db.username);
    const socket = db.searchParams.get("host");
    const local = env.NODE_ENV === "test" && socket?.startsWith("/private/tmp/");
    const host = socket ?? db.hostname;
    const allowedParameters = local ? ["host", "port"] : ["sslmode"];
    if (!["postgres:", "postgresql:"].includes(db.protocol) || !db.password || !user || !database
      || db.hash || database.includes("/") || !env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST
      || host !== env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST
      || database !== env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME
      || user !== env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER
      || [...db.searchParams.keys()].some((key, index, keys) => !allowedParameters.includes(key) || keys.indexOf(key) !== index)
      || (!local && (socket !== null || db.searchParams.get("sslmode") !== "require"))) throw unavailable();
    return Object.freeze({ connectionString: raw, database, user, secretKey: env.CLERK_SECRET_KEY! });
  } catch { throw unavailable(); }
}

export function candidateRoute(req: Request): CandidateRoute {
  const { pathname, search } = new URL(req.url);
  if (!(connectedCandidatePaths as readonly string[]).includes(pathname)) throw new Response("Not found", { status: 404 });
  const method = req.method === "OPTIONS" ? req.headers.get("access-control-request-method") : req.method;
  if (req.headers.get("origin") !== null && req.headers.get("origin") !== connectedCandidateOrigin) {
    throw new Response("Origin is not allowed", { status: 403 });
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new Response("Origin is not allowed", { status: 403 });
  if (pathname === "/api/portal/synced-skills" && method === "GET") {
    if (search !== "?version=3") throw new Response("Use the exact version-3 inventory read", { status: 400 });
    return "read";
  }
  if (pathname === "/api/portal/sync-upload" && method === "GET") {
    if (search !== "?reportVersion=3") throw new Response("Use the exact version-3 revision read", { status: 400 });
    return "revision";
  }
  if (search) throw new Response("Query is not supported", { status: 400 });
  if (method !== "POST") throw new Response("Method not allowed", { status: 405 });
  switch (pathname) {
    case "/api/portal/sync-pairing-code": return "pair";
    case "/api/portal/sync-exchange": return "exchange";
    case "/api/portal/sync-upload": return "upload";
    case "/api/portal/device-revoke": return "revoke";
    default: throw new Response("Method not allowed", { status: 405 });
  }
}

// The candidate never resolves Netlify's managed/default database. Verify the
// actual database/user before handing the same pool to any write service.
export function candidateDatabase(createPool: (connectionString: string) => Pool = connectionString =>
  new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, query_timeout: 5000 })) {
  let cached: { configuration: ConnectedCandidateConfiguration; ready: Promise<Pool> } | undefined;
  return (configuration: ConnectedCandidateConfiguration): Promise<Pool> => {
    if (cached) {
      if (Object.keys(configuration).some(key => configuration[key as keyof typeof configuration] !== cached!.configuration[key as keyof typeof configuration])) {
        return Promise.reject(unavailable());
      }
      return cached.ready;
    }
    const pool = createPool(configuration.connectionString);
    const ready = (async () => {
      try {
        const { rows } = await pool.query("SELECT current_database() AS database, current_user AS username");
        if (rows.length !== 1 || rows[0].database !== configuration.database || rows[0].username !== configuration.user) throw unavailable();
        return pool;
      } catch {
        try { await pool.end(); } catch { /* Preserve the safe configuration error. */ }
        cached = undefined;
        throw unavailable();
      }
    })();
    cached = { configuration, ready };
    return ready;
  };
}
