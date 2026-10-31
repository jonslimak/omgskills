/**
 * Release acceptance against the live catalog, for the hosted endpoint or a stdio server:
 *   tsx scripts/acceptance.ts --url https://omgskills.com/mcp --version 0.2.5
 *   tsx scripts/acceptance.ts --stdio "npx -y omgskills-mcp@0.2.5" --version 0.2.5
 * Covers the 2026-10-31 audit items and the behavior earlier releases fixed. Exits 1 on any failure.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
const url = arg("url"), stdio = arg("stdio"), version = arg("version");
if (!url === !stdio) throw new Error("Pass exactly one of --url or --stdio");

const client = new Client({ name: "omgskills-acceptance", version: "1" });
const [command, ...args] = stdio?.split(" ") ?? [];
await client.connect(url ? new StreamableHTTPClientTransport(new URL(url)) : new StdioClientTransport({ command, args }));

type Row = { id: string; name?: string; description?: string; install_status?: string; install_cmd?: string; score?: number; pinned_install?: unknown };
type Result = { structuredContent?: any; content: { text: string }[]; isError?: boolean };
const call = async (name: string, args: object) => await client.callTool({ name, arguments: args as Record<string, unknown> }) as Result;
const value = async (name: string, args: object) => (await call(name, args)).structuredContent;
const failures: string[] = [];
async function check(label: string, run: () => Promise<boolean | string>) {
  try {
    const result = await run();
    if (result === true) console.log(`ok   ${label}`);
    else { failures.push(label); console.log(`FAIL ${label}${typeof result === "string" ? `: ${result}` : ""}`); }
  } catch (error) { failures.push(label); console.log(`FAIL ${label}: ${error instanceof Error ? error.message : error}`); }
}
const ids = (rows: Row[]) => rows.map(row => row.id);

// Release
if (version) await check(`server reports ${version}`, async () => client.getServerVersion()?.version === version || `got ${client.getServerVersion()?.version}`);

// Audit 1-3: install command, related scores, install-plan alternatives
await check("get_skill has no legacy install_cmd and has per-agent installs", async () => {
  const skill = (await value("get_skill", { id: "anthropics/skills:pdf" })).skill;
  return skill.install_cmd === undefined && Boolean(skill.install?.claude_code && skill.install?.codex && skill.install?.cursor);
});
await check("full search rows have no install_cmd", async () => (await value("search_skills", { query: "pdf", summary: false })).skills.every((row: Row) => row.install_cmd === undefined));
await check("related_skills full rows keep their scores", async () => {
  const summary = (await value("related_skills", { id: "anthropics/skills:pdf" })).skills as Row[];
  const full = (await value("related_skills", { id: "anthropics/skills:pdf", summary: false })).skills as Row[];
  return full.length > 0 && full.every((row, index) => row.score === summary[index].score && (row.score ?? 0) > 0);
});
await check("install-plan alternatives carry pinned_install", async () => {
  const plan = await value("get_install_plan", { id: "lobehub/lobehub:react" });
  if (plan.installable) return "lobehub/lobehub:react is installable now; pick another discovery_only example";
  return (plan.alternatives ?? []).length > 0 && plan.alternatives.every((row: Row) => row.install_status === "pinned" && row.pinned_install);
});

// Audit 4: search quality
await check("swiftui, swift ui and swift-ui return the same skills", async () => {
  const pages = await Promise.all(["swiftui", "swift ui", "swift-ui"].map(query => value("search_skills", { query, limit: 100 })));
  const totals = pages.map(page => page.page.total), first = JSON.stringify(ids(pages[0].skills).sort());
  return pages.every(page => JSON.stringify(ids(page.skills).sort()) === first) && new Set(totals).size === 1 || `totals ${totals.join("/")}`;
});
await check("a pptx skill is in the top 5 for 'make slides from a document'", async () =>
  ids((await value("search_skills", { query: "make slides from a document", limit: 5 })).skills).some(id => /pptx/i.test(id)));
await check("nonsense returns no results", async () => (await value("search_skills", { query: "zzqxv nonsense" })).count === 0);
await check("react sorted by stars lists React skills only", async () =>
  (await value("search_skills", { query: "react", sort: "stars", limit: 10 })).skills.every((row: Row) => /react/i.test(`${row.id} ${row.name}`)));
await check("not-found suggestions are close names", async () => !/Did you mean/.test((await call("get_skill", { id: "nobody/nothing:zephyr-react-ui" })).content[0].text));

// Audit 5: duplicates and IDs
await check("'frontend design' lists Anthropic's skill once", async () =>
  ids((await value("search_skills", { query: "frontend design", limit: 30 })).skills).filter(id => /^anthropics\//i.test(id)).length === 1);
await check("short form of a path ID resolves", async () => (await value("get_skill", { id: "anthropics/skills:frontend-design" })).skill?.id === "anthropics/skills:skills/frontend-design");

// Audit 6: gold basket
await check("gold basket full rows report the catalog install status", async () => {
  const [summary, full] = await Promise.all([true, false].map(async summary => (await value("list_gold_basket", { limit: 20, summary })).skills as Row[]));
  return full.every((row, index) => row.install_status === summary[index].install_status) || `${full.filter(row => row.install_status === "pinned").length}/20 pinned in full rows`;
});

// Must keep working
await check("installable: true search pages contain only pinned skills, and a bad cursor is rejected", async () => {
  const first = await value("search_skills", { query: "design", installable: true, limit: 20 });
  const second = await value("search_skills", { query: "design", installable: true, limit: 20, page: { cursor: first.page.nextCursor } });
  const bad = await call("search_skills", { query: "design", installable: true, page: { cursor: "not-a-cursor" } });
  const rows = [...first.skills, ...second.skills] as Row[];
  return rows.every(row => row.install_status === "pinned") && new Set(ids(rows)).size === rows.length && Boolean(bad.isError);
});
await check("related_skills installable: true returns only pinned skills", async () =>
  (await value("related_skills", { id: "anthropics/skills:pdf", installable: true, limit: 10 })).skills.every((row: Row) => row.install_status === "pinned"));
await check("list_gold_basket pages through every item without duplicates", async () => {
  const seen: string[] = []; let cursor: string | null | undefined, pages = 0, total = 0;
  do {
    const page = await value("list_gold_basket", { limit: 100, ...(cursor ? { page: { cursor } } : {}) });
    seen.push(...ids(page.skills)); total = page.page.total; cursor = page.page.nextCursor; pages++;
  } while (cursor && pages < 20);
  return seen.length === total && new Set(seen).size === total && pages === Math.ceil(total / 100) || `${seen.length} of ${total} in ${pages} pages`;
});
await check("Cursor install targets and safe scripts", async () => {
  const user = await value("get_install_plan", { id: "anthropics/skills:pdf", agent: "cursor", scope: "user" });
  const project = await value("get_install_plan", { id: "anthropics/skills:pdf", agent: "cursor", scope: "project" });
  return user.destination === "~/.cursor/skills/pdf" && project.destination === ".cursor/skills/pdf"
    && user.script.startsWith("set -e") && /already exists/.test(user.script) || `${user.destination} / ${project.destination}`;
});
await check("summary descriptions are at most 160 characters; trending 100 stays small", async () => {
  const response = await call("list_trending", { limit: 100 });
  const bytes = Buffer.byteLength(JSON.stringify(response));
  return response.structuredContent.skills.every((row: Row) => Array.from(row.description ?? "").length <= 160) && bytes < 120_000 || `${bytes} bytes`;
});
await check("get_skill_content files are hash-verified and traversal is rejected", async () => {
  const read = await value("get_skill_content", { id: "anthropics/skills:pdf", include_files: true, file_paths: ["SKILL.md"] });
  const traversal = await call("get_skill_content", { id: "anthropics/skills:pdf", include_files: true, file_paths: ["../secret"] });
  return read.file_inspection?.available && read.file_inspection.files.some((file: { hash_verified?: boolean }) => file.hash_verified) && Boolean(traversal.isError)
    || JSON.stringify(read.file_inspection?.reason ?? "");
});
await check("include_files never falls back to the default branch", async () => {
  const unpinned = ((await value("search_skills", { query: "pdf", limit: 100 })).skills as Row[]).find(row => row.install_status === "discovery_only");
  if (!unpinned) return "no discovery_only pdf skill found";
  const read = await value("get_skill_content", { id: unpinned.id, include_files: true });
  return read.file_inspection?.available === false && read.pinned === false;
});
await check("too-long query is one input error", async () => Boolean((await call("search_skills", { query: "x".repeat(1001) })).isError));
await check("not-found has one shape across tools", async () => {
  const missing = "nobody/nothing:missing";
  const [skill, plan, content, related] = await Promise.all(["get_skill", "get_install_plan", "get_skill_content", "related_skills"].map(name => value(name, { id: missing })));
  return [skill, plan, content, related].every(result => result.found === false);
});
await check("get_skill stays small", async () => {
  const bytes = Buffer.byteLength(JSON.stringify(await call("get_skill", { id: "anthropics/skills:pdf" })));
  return bytes < 7000 || `${bytes} bytes`;
});

await client.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
