import type { Config, Context } from "@netlify/functions";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createOmgskillsServer } from "../../mcp/src/server.js";
import { fetchWithTimeout, loadProductionMcpLibrary, productionMcpTracks, type McpLibraryLoader } from "./_shared/mcp-library.js";
import { createCompactMcpLibraryLoader, type CompactMcpLoader } from "./_shared/compact-mcp-library.js";
import featureConfig from "../../config/production-features.json" with { type: "json" };
import { validateProductionFeatures } from "../../config/production-features.mjs";
import { catalogInstallRecord, catalogInstallRecordPath, createQuickInstallRecordReader,
  type QuickInstallRecordRead } from "./_shared/catalog-install-record.js";
import type { CatalogReader } from "../../mcp/src/catalog-reader.js";
import type { SkillResult } from "../../mcp/src/library.js";

const maximumRequestBytes = 64 * 1024;

// Keep the legacy factory synchronous-reader-only for the separate install-record route.
export function createMcpHandler(loader: McpLibraryLoader, installRecordQuick?: QuickInstallRecordRead) {
  return withInstallRecordRoute(createReadMcpHandler(loader), loader, installRecordQuick);
}

export function createCompactMcpHandler(loader: CompactMcpLoader, options: { paging?: boolean; ranking?: boolean } = {}) {
  return createReadMcpHandler(loader, options);
}

function createReadMcpHandler(loader: McpLibraryLoader | CompactMcpLoader, options: { paging?: boolean; ranking?: boolean } = {}) {
  return async (request: Request, context: Pick<Context, "waitUntil">): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/mcp/health") {
      return healthResponse(loader, context, options.ranking === true);
    }

    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) {
      return jsonRpcError(413, -32000, "Request body too large");
    }

    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return jsonRpcError(415, -32000, "Content-Type must be application/json");
    }

    const startedAt = performance.now();
    const cold = !loader.status().hasSnapshot;
    let started: ReturnType<typeof loader.get> | undefined;
    // Cold start: answer a single get_skill from small assets while the full catalog loads.
    if (cold && "quickSkill" in loader && loader.quickSkill) {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > maximumRequestBytes) return jsonRpcError(413, -32000, "Request body too large");
      // Start the full load first so a slow quick read never delays it; it continues after the response.
      started = loader.get();
      context.waitUntil(started.then(() => undefined, () => undefined));
      const quick = await quickGetSkill(body, loader.quickSkill);
      if (quick) {
        return respond(createOmgskillsServer(quickLibrary(quick), options), new Request(request, { body }), context,
          `catalog;dur=${(performance.now() - startedAt).toFixed(1)};desc="quick"`, startedAt);
      }
      request = new Request(request, { body });
    }
    let snapshot;
    let catalogMs = 0;
    try {
      snapshot = await (started ?? loader.get());
      catalogMs = performance.now() - startedAt;
      if (cold) console.info(`MCP catalog cold load: ${Math.round(catalogMs)}ms (${snapshot.skillCount} skills)`);
      keepRefreshAlive(loader, context);
    } catch (error) {
      console.error("MCP catalog load failed:", error);
      return jsonRpcError(503, -32603, "Catalog temporarily unavailable");
    }

    return respond(createOmgskillsServer(snapshot.library, options), request, context,
      `catalog;dur=${catalogMs.toFixed(1)};desc="${cold ? "cold load" : "warm"}"`, startedAt);
  };
}

async function respond(server: ReturnType<typeof createOmgskillsServer>, request: Request, context: Pick<Context, "waitUntil">,
  catalogTiming: string, startedAt: number): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: maximumRequestBytes
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    context.waitUntil(server.close());
    return hardened(response, `${catalogTiming}, total;dur=${(performance.now() - startedAt).toFixed(1)}`);
  } catch (error) {
    console.error("MCP request failed:", error);
    context.waitUntil(server.close());
    return jsonRpcError(500, -32603, "Internal server error");
  }
}

/** The skill for a single JSON-RPC tools/call get_skill request, if the quick reader has it. */
async function quickGetSkill(body: string, quickSkill: (id: string) => Promise<SkillResult | undefined>) {
  let message: unknown;
  try { message = JSON.parse(body); } catch { return undefined; }
  const call = message as { method?: unknown; params?: { name?: unknown; arguments?: { id?: unknown } } };
  if (!call || Array.isArray(call) || call.method !== "tools/call" || call.params?.name !== "get_skill") return undefined;
  const id = call.params.arguments?.id;
  return typeof id === "string" && id.length <= 500 ? quickSkill(id) : undefined;
}

/** A reader that only answers get_skill for the one skill already read. */
function quickLibrary(skill: SkillResult): CatalogReader {
  return new Proxy({ getSkill: async (id: string) => id.trim().replace(/^catalog:/i, "") === skill.id ? skill : undefined } as CatalogReader, {
    get(target, property) {
      if (property in target) return target[property as keyof CatalogReader];
      throw new Error(`Quick catalog cannot answer ${String(property)}`);
    }
  });
}

export function createConfiguredMcpHandler(enabled: boolean, loaders?: { legacy: McpLibraryLoader; compact: CompactMcpLoader;
  installRecordQuick?: QuickInstallRecordRead }) {
  const legacy = loaders?.legacy ?? loadProductionMcpLibrary;
  // The legacy loader's first track, read from its small published assets until the full load lands.
  const quick = loaders ? loaders.installRecordQuick
    : createQuickInstallRecordReader(productionMcpTracks[0].manifestUrl, { fetcher: fetchWithTimeout });
  return enabled ? withInstallRecordRoute(createCompactMcpHandler(
    loaders?.compact ?? createCompactMcpLibraryLoader({ ranking: true }), { paging: true, ranking: true }), legacy, quick)
    : createMcpHandler(legacy, quick);
}

function withInstallRecordRoute(handler: ReturnType<typeof createReadMcpHandler>, loader: McpLibraryLoader,
  quick?: QuickInstallRecordRead) {
  return (request: Request, context: Pick<Context, "waitUntil">): Promise<Response> =>
    new URL(request.url).pathname === catalogInstallRecordPath
      ? catalogInstallRecord(request, loader, work => context.waitUntil(work), quick)
      : handler(request, context);
}

const handler = createConfiguredMcpHandler(validateProductionFeatures(featureConfig).catalogSearchEnabled);
export default handler;

export const config: Config = {
  path: ["/mcp", "/mcp/health", "/api/catalog/install-record"],
  rateLimit: {
    windowLimit: 600,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

async function healthResponse(loader: McpLibraryLoader | CompactMcpLoader, context: Pick<Context, "waitUntil">, ranked = false): Promise<Response> {
  try {
    const snapshot = await loader.get();
    keepRefreshAlive(loader, context);
    const state = loader.status();
    const ageMs = Math.max(0, Date.now() - snapshot.loadedAt);
    return Response.json({
      ok: true,
      sourceTrack: snapshot.sourceTrack,
      skillCount: snapshot.skillCount,
      loadedAt: new Date(snapshot.loadedAt).toISOString(),
      ageSeconds: Math.floor(ageMs / 1000),
      stale: ageMs >= state.maxAgeMs,
      refreshing: state.refreshing,
      lastRefreshFailed: state.lastRefreshFailed,
      ...("diagnostics" in snapshot.library ? { catalog: snapshot.library.diagnostics() }
        : ranked ? { catalog: { mode: "full", degraded: true } } : {}),
      optionalData: {
        trending: snapshot.trendingCount > 0,
        goldBasket: snapshot.goldBasketCount > 0
      }
    }, {
      headers: responseHeaders()
    });
  } catch (error) {
    console.error("MCP health check failed:", error);
    return Response.json({ ok: false, error: "Catalog temporarily unavailable" }, {
      status: 503,
      headers: responseHeaders()
    });
  }
}

function keepRefreshAlive(loader: McpLibraryLoader | CompactMcpLoader, context: Pick<Context, "waitUntil">) {
  const pendingRefresh = loader.pendingRefresh();
  if (pendingRefresh) context.waitUntil(pendingRefresh.then(() => undefined));
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null
  }, {
    status,
    headers: responseHeaders()
  });
}

function hardened(response: Response, timing?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(responseHeaders())) headers.set(name, value);
  if (timing) headers.set("Server-Timing", timing);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Visible in browser dev tools and curl; lets production show load versus request time.

function responseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}
