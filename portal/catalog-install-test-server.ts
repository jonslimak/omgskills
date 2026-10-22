import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OmgskillsLibrary, type Skill, type TrendingEntry } from "../mcp/src/library";
import { createMcpHandler } from "../netlify/functions/omgskills-mcp.mts";
import type { McpLibraryLoader, McpLibrarySnapshot } from "../netlify/functions/_shared/mcp-library";

export function catalogInstallServerEnabled(command: string, env: Record<string, string | undefined>) {
  if (command !== "serve" || env.VITE_NEWMAC_CATALOG_INSTALL_TEST !== "1") return false;
  if (["VITE_NEWMAC_WEB_INSTALL_TEST", "VITE_NEWMAC_F1", "VITE_NEWMAC_SETUP_TEST", "VITE_PORTAL_INTEGRATION", "VITE_PORTAL_PREVIEW"]
    .some(key => env[key] === "1")) throw Error("Catalog install test cannot share another test mode.");
  return true;
}

export function localCatalogLoader(root: string): McpLibraryLoader {
  let pending: Promise<McpLibrarySnapshot> | null = null;
  let loaded = false;
  const get = () => pending ??= (async () => {
    const skills = JSON.parse(await readFile(path.join(root, "index/skills.json"), "utf8")) as Skill[];
    if (!Array.isArray(skills) || !skills.length) throw Error("Local catalog is unavailable.");
    let trending: TrendingEntry[] = [];
    try {
      const value = JSON.parse(await readFile(path.join(root, "index/trending.json"), "utf8"));
      if (Array.isArray(value)) trending = value;
    } catch { /* Trending is optional; never fetch a different remote snapshot. */ }
    const library = OmgskillsLibrary.fromData({ skills, trending, goldBasket: [] });
    loaded = true;
    return { library, sourceTrack: "local-catalog-install-test", loadedAt: Date.now(),
      skillCount: skills.length, trendingCount: trending.length, goldBasketCount: 0 };
  })();
  return { get, refresh: get, pendingRefresh: () => null,
    status: () => ({ hasSnapshot: loaded, refreshing: false, lastRefreshFailed: false, maxAgeMs: Number.MAX_SAFE_INTEGER }) };
}

const routes = new Set(["/mcp", "/mcp/health", "/api/catalog/install-record", "/data/crawl4/manifest.json",
  "/data/crawl4/collections.json", "/catalog-skill-urls.json"]);
const limit = 64 * 1024;

export function catalogInstallMiddleware(loader: McpLibraryLoader) {
  const handler = createMcpHandler(loader);
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let url: URL;
    try { url = new URL(req.url || "/", "http://localhost"); } catch { res.writeHead(400).end(); return; }
    if (!routes.has(url.pathname) && !url.pathname.startsWith("/api/portal")) return next();
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(body));
    };
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) return reply(403, { error: "Loopback only." });
    if (url.pathname.startsWith("/api/portal")) return reply(403, { error: "Account requests are disabled in this install test." });
    if (req.method !== (url.pathname === "/mcp" ? "POST" : "GET")) return reply(405, { error: "Read-only catalog test." });
    if (url.pathname === "/data/crawl4/manifest.json") return reply(200, { collections: { path: "collections.json" } });
    if (url.pathname === "/data/crawl4/collections.json") return reply(200, { collections: [] });
    if (url.pathname === "/catalog-skill-urls.json") return reply(200, { skills: {} });
    void (async () => {
      const body = req.method === "POST" ? await boundedBody(req) : undefined;
      if (body === null) return reply(413, { error: "Request body too large." });
      // Only public catalog inputs cross the bridge; cookies and credentials do not.
      const response = await handler(new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method, headers: { "content-type": req.headers["content-type"] || "application/json",
          accept: "application/json, text/event-stream" }, ...(body ? { body: new Uint8Array(body) } : {}),
      }), { waitUntil: promise => { void promise.catch(() => undefined); } });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => { if (!res.headersSent) reply(503, { error: "Local catalog is unavailable." }); else res.end(); });
  };
}

function boundedBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) { chunks.length = 0; resolve(null); }
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(bytes > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("aborted", () => reject(Error("Request aborted.")));
  });
}
