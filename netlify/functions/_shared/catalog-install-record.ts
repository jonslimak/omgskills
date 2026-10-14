import type { Skill } from "../../../mcp/src/library.js";
import type { McpLibraryLoader } from "./mcp-library.js";

export const catalogInstallRecordPath = "/api/catalog/install-record";
const fields = ["id", "name", "description", "author_handle", "github_url", "install_cmd",
  "repo_slug", "skill_md_path", "repo_commit_sha", "skill_tree_sha", "skill_md_sha", "install_target_name"] as const;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function catalogInstallRecord(request: Request, loader: McpLibraryLoader,
  waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const query = new URL(request.url).searchParams;
  const id = query.get("id");
  if ([...query.keys()].some(key => key !== "id") || query.getAll("id").length !== 1
    || !id?.trim() || Buffer.byteLength(id, "utf8") > 500 || /[\p{Cc}\p{Cf}]/u.test(id)) {
    return Response.json({ error: "One catalog ID is required" }, { status: 400, headers });
  }
  try {
    const snapshot = await loader.get();
    const refresh = loader.pendingRefresh();
    if (refresh) waitUntil(refresh.then(() => undefined));
    const record = snapshot.library.getSkill(id);
    // Project the raw record, not the agent-facing MCP schema. Partial pins stay partial.
    const skill = record ? Object.fromEntries(fields.filter(key => record[key] !== undefined)
      .map(key => [key, record[key as keyof Skill]])) : null;
    const body = JSON.stringify({ version: 1, found: skill !== null, skill });
    if (Buffer.byteLength(body, "utf8") > 256 * 1024) throw new Error("Install record too large");
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "Catalog temporarily unavailable" }, { status: 503, headers });
  }
}
