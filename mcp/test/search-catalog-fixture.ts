import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { buildSearchCatalog } from "../../scripts/search-catalog.mjs";
import { sha256 } from "../src/search-catalog-format.mjs";
import { OmgskillsLibrary, type GoldBasketEntry, type LoadedLibrary, type Skill } from "../src/library.js";

export const rows = [
  { id: "example/skills:swift-review", name: "swift-review", description: "Swift app store review design 中文", author_handle: "Example", github_url: "https://github.com/example/skills", install_cmd: "legacy swift", tags: ["swift", "design"], stars: 1200,
    repo_slug: "example/skills", install_target_name: "legacy-alias", skill_md_path: "skills/swift-review/SKILL.md", skill_md_sha: "c".repeat(40), repo_commit_sha: "a".repeat(40), skill_tree_sha: "b".repeat(40), readme_snippet: "keep privately projected" },
  { id: "example/skills:root", name: "root", description: "Swift root example", author_handle: "example", github_url: "https://github.com/example/skills", install_cmd: "legacy root", tags: ["swift"], stars: 10, skill_md_path: "SKILL.md", skill_md_sha: null, extra: { fields: [null, 1] } },
  { id: "another/repo:ui-design", name: "ui-design", description: "UI design workflow", author_handle: "another", github_url: "https://github.com/another/repo", install_cmd: "legacy ui", tags: ["ui"], stars: 30 },
] as unknown as Skill[];
export const trending = [{ id: rows[0].id, trending_rank: 1, installs: 120 }, { id: rows[1].id, trending_rank: 2 }];
export const goldBasket: GoldBasketEntry[] = [
  { ...rows[0], name: "Curated name", install_cmd: "curated command", score: 98 },
  { ...rows[2], id: "curated/only:extra", name: "curated-only", score: 90 },
];

export function catalogFixture(context: Pick<TestContext, "after">, skills = rows, ranking = false, signals: { trending?: LoadedLibrary["trending"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "compact-mcp-"));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from(JSON.stringify(skills) + "\n");
  const hash = sha256(bytes), source = { path: `skills-${hash.slice(0, 12)}.json`, sha256: hash, bytes: bytes.length };
  writeFileSync(join(dir, source.path), bytes);
  const ref = buildSearchCatalog(dir, source, { generatedAt: "2026-10-16", ranking });
  const selectedTrending = signals.trending ?? trending;
  const trendBytes = Buffer.from(JSON.stringify(selectedTrending));
  const trendHash = sha256(trendBytes);
  const manifest = { skills: source, searchCatalog: ref, trending: { path: `trending-${trendHash.slice(0, 12)}.json`, sha256: trendHash, bytes: trendBytes.length } };
  const files = new Map<string, Uint8Array>(readdirSync(dir).map(name => [`https://catalog.test/${name}`, readFileSync(join(dir, name))]));
  files.set("https://catalog.test/" + manifest.trending.path, trendBytes);
  files.set("https://catalog.test/manifest.json", Buffer.from(JSON.stringify(manifest)));
  files.set("https://catalog.test/gold.json", Buffer.from(JSON.stringify(goldBasket)));
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); requested.push(url);
    const value = files.get(url);
    return value ? new Response(value as BodyInit, { headers: { "content-type": "application/json" } }) : new Response("missing", { status: 404 });
  };
  const options = { fetcher, goldBasketUrl: "https://catalog.test/gold.json" };
  return { dir, manifest, files, requested, fetcher, options,
    legacy: OmgskillsLibrary.fromData({ skills, trending: selectedTrending, goldBasket }), url: "https://catalog.test/manifest.json" };
}
