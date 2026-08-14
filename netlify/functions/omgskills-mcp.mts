import type { Config, Context } from "@netlify/functions";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createOmgskillsServer } from "../../mcp/src/server.js";
import { loadProductionMcpLibrary, type McpLibraryLoader } from "./_shared/mcp-library.js";

const maximumRequestBytes = 64 * 1024;

export function createMcpHandler(loader: McpLibraryLoader) {
  return async (request: Request, context: Pick<Context, "waitUntil">): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/mcp/health") {
      return healthResponse(loader, context);
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

    let snapshot;
    try {
      snapshot = await loader.get();
      keepRefreshAlive(loader, context);
    } catch (error) {
      console.error("MCP catalog load failed:", error);
      return jsonRpcError(503, -32603, "Catalog temporarily unavailable");
    }

    const server = createOmgskillsServer(snapshot.library);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      context.waitUntil(server.close());
      return hardened(response);
    } catch (error) {
      console.error("MCP request failed:", error);
      context.waitUntil(server.close());
      return jsonRpcError(500, -32603, "Internal server error");
    }
  };
}

const handler = createMcpHandler(loadProductionMcpLibrary);
export default handler;

export const config: Config = {
  path: ["/mcp", "/mcp/health"],
  rateLimit: {
    windowLimit: 600,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

async function healthResponse(loader: McpLibraryLoader, context: Pick<Context, "waitUntil">): Promise<Response> {
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

function keepRefreshAlive(loader: McpLibraryLoader, context: Pick<Context, "waitUntil">) {
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

function hardened(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(responseHeaders())) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function responseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}
