import type { Skill } from "../../../mcp/src/library.js";
import { QuickSkillReader, type CatalogReadOptions } from "../../../mcp/src/search-catalog.js";
import type { McpLibraryLoader } from "./mcp-library.js";

export const catalogInstallRecordPath = "/api/catalog/install-record";
const fields = ["id", "name", "description", "author_handle", "github_url", "install_cmd",
  "repo_slug", "skill_md_path", "repo_commit_sha", "skill_tree_sha", "skill_md_sha", "install_target_name"] as const;
// Every catalog record has these; pins stay optional (partial pins are answered as they are).
const requiredFields = ["id", "name", "description", "author_handle", "github_url", "install_cmd"] as const;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

/** One catalog record by exact ID from small published assets, or undefined. */
export type QuickInstallRecordRead = (id: string) => Promise<Skill | undefined>;

/**
 * Cold-start install records from the detail index (~35 KB) and one detail shard, instead of the
 * full skills file (~88 MB, ~20 s cold). Shard rows are the published skills file's own records,
 * verified by the same hash chain, so the projected record is identical to the full loader's.
 */
export function createQuickInstallRecordReader(manifestUrl: string, options: CatalogReadOptions & {
  now?: () => number; maxAgeMs?: number } = {}): QuickInstallRecordRead {
  const now = options.now ?? Date.now, maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
  let reader: { value: Promise<QuickSkillReader | null>; loadedAt: number } | null = null;
  return async id => {
    if (!reader || now() - reader.loadedAt >= maxAgeMs) {
      const value = QuickSkillReader.load(manifestUrl, options, false);
      const entry = { value, loadedAt: now() };
      reader = entry;
      value.catch(() => { if (reader === entry) reader = null; });
    }
    return (await (await reader.value)?.getRawSkill(id)) as Skill | undefined;
  };
}

export async function catalogInstallRecord(request: Request, loader: McpLibraryLoader,
  waitUntil: (work: Promise<unknown>) => void, quick?: QuickInstallRecordRead): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const query = new URL(request.url).searchParams;
  const id = query.get("id");
  if ([...query.keys()].some(key => key !== "id") || query.getAll("id").length !== 1
    || !id?.trim() || Buffer.byteLength(id, "utf8") > 500 || /[\p{Cc}\p{Cf}]/u.test(id)) {
    return Response.json({ error: "One catalog ID is required" }, { status: 400, headers });
  }
  try {
    let record: Skill | undefined;
    if (quick && !loader.status().hasSnapshot) {
      // Start the full load first; it continues after a quick answer so later requests are warm.
      const full = loader.get();
      waitUntil(full.then(() => undefined, () => undefined));
      record = await quick(id).then(found => found && requiredFields.every(key => found[key] !== undefined) ? found : undefined,
        () => undefined);
      // Unknown, curated-only, differently cased or incomplete: the full catalog decides, as before.
      record ??= (await full).library.getSkill(id);
    } else {
      const snapshot = await loader.get();
      const refresh = loader.pendingRefresh();
      if (refresh) waitUntil(refresh.then(() => undefined));
      record = snapshot.library.getSkill(id);
    }
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
