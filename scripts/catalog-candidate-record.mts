import type { Config, Context } from "@netlify/functions";
import { catalogInstallRecord } from "../netlify/functions/_shared/catalog-install-record.js";
import { loadProductionMcpLibrary } from "../netlify/functions/_shared/mcp-library.js";

// Outside netlify/functions: only the isolated candidate packager includes this entry.
export default async function handler(request: Request, context: Context): Promise<Response> {
  if (context.site.id !== "16f435c1-e5d0-4b40-b174-382d839e877b"
    || new URL(request.url).pathname !== "/api/catalog/install-record") {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  }
  const response = await catalogInstallRecord(request, loadProductionMcpLibrary, work => context.waitUntil(work));
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config: Config = {
  path: "/api/catalog/install-record",
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
