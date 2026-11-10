import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { fetchSkillsShBoard, isSkillsShUnavailableError, type SkillsShEntry } from "./sources/skillssh.js";
import { loadTrustedSeeds } from "./new-crawl/seeds.js";
import { filterSourceTrending, sourceTrendingUrl, validateSourceTrending,
  type SourceTrendingFeed, type SourceTrendingPolicy } from "../../scripts/source-trending-format.mjs";

type LibrarySkill = { id: string; name: string; repo_slug?: string; skill_md_path?: string };

export function buildSourceTrending(entries: SkillsShEntry[], skills: LibrarySkill[], policy: SourceTrendingPolicy,
  fetchedAt = new Date().toISOString()): SourceTrendingFeed {
  const byId = new Map(skills.map(skill => [skill.id.toLowerCase(), skill]));
  const seen = new Set<string>();
  const feed: SourceTrendingFeed = { version: 1, source: "skills.sh", board: "trending", fetchedAt,
    entries: entries.flatMap((entry, index) => {
      const id = `${entry.source}:${entry.skillId}`.toLowerCase();
      if (seen.has(id)) return [];
      seen.add(id);
      // Only link an exact catalog identity. A matching display name is not proof of origin.
      const skill = byId.get(id);
      return [{ source: entry.source, skillId: entry.skillId, name: entry.name || entry.skillId,
        rank: index + 1, installs24h: entry.installs,
        sourceUrl: sourceTrendingUrl(entry.source, entry.skillId), ...(skill ? { catalogId: skill.id } : {}) }];
    }) };
  return filterSourceTrending(validateSourceTrending(feed), policy, skills);
}

export async function refreshSourceTrending({ entries, skills, policy, outputPath,
  fetchBoard = () => fetchSkillsShBoard({ board: "trending" }), now = () => new Date().toISOString(),
}: { entries?: SkillsShEntry[]; skills: LibrarySkill[]; policy: SourceTrendingPolicy; outputPath: string;
  fetchBoard?: () => Promise<{ entries: SkillsShEntry[] }>; now?: () => string }): Promise<SourceTrendingFeed> {
  let feed;
  try {
    const source = entries ?? (await fetchBoard()).entries;
    if (!source.length) throw new Error("Source Trending returned no entries");
    feed = buildSourceTrending(source, skills, policy, now());
  } catch (error) {
    if (!isSkillsShUnavailableError(error) || !existsSync(outputPath)) throw error;
    const previous = validateSourceTrending(JSON.parse(readFileSync(outputPath, "utf8")));
    console.warn("[source-unavailable] Keeping source Trending with its original fetch timestamp");
    return previous;
  }
  writeFileSync(`${outputPath}.tmp`, `${JSON.stringify(feed, null, 2)}\n`);
  renameSync(`${outputPath}.tmp`, outputPath);
  return feed;
}

export function sourceTrendingPolicy() {
  const seeds = loadTrustedSeeds();
  return { blockedRepos: [...(seeds.doNotCrawlRepos ?? [])], blockedOwners: [...(seeds.doNotCrawlOwners ?? [])],
    catalogRepos: seeds.catalogRepoRules.map(rule => rule.repo), suppressedIds: [...(seeds.suppressedSkillIds ?? [])] };
}
