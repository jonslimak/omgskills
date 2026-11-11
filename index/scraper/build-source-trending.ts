import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchSkillsShBoard, isSkillsShUnavailableError, type SkillsShEntry } from "./sources/skillssh.js";
import { loadTrustedSeeds } from "./new-crawl/seeds.js";
import { filterSourceTrending, isFreshSkill, sourceTrendingUrl, validateSourceTrending,
  type SourceTrendingFeed, type SourceTrendingPolicy } from "../../scripts/source-trending-format.mjs";

type LibrarySkill = { id: string; name: string; repo_slug?: string; skill_md_path?: string; github_url?: string };

export function buildSourceTrending(entries: SkillsShEntry[], skills: LibrarySkill[], policy: SourceTrendingPolicy,
  fetchedAt = new Date().toISOString(), allTime?: SkillsShEntry[]): SourceTrendingFeed {
  const byId = new Map(skills.map(skill => [skill.id.toLowerCase(), skill]));
  // Weekly history from the all-time board. A skill on today's list but not in the all-time top
  // has few lifetime installs and many today: new. Without the all-time board nothing is marked new.
  const weekly = allTime?.length ? new Map(allTime.map(entry => [`${entry.source}:${entry.skillId}`.toLowerCase(), entry.weeklyInstalls])) : undefined;
  const seen = new Set<string>();
  const feed: SourceTrendingFeed = { version: 1, source: "skills.sh", board: "trending", fetchedAt,
    entries: entries.flatMap((entry, index) => {
      const id = `${entry.source}:${entry.skillId}`.toLowerCase();
      if (seen.has(id)) return [];
      seen.add(id);
      // Only link an exact catalog identity. A matching display name is not proof of origin.
      const skill = byId.get(id);
      const fresh = weekly && (!weekly.has(id) || isFreshSkill(weekly.get(id)));
      return [{ source: entry.source, skillId: entry.skillId, name: entry.name || entry.skillId,
        rank: index + 1, installs24h: entry.installs, ...(fresh ? { fresh: true as const } : {}),
        sourceUrl: sourceTrendingUrl(entry.source, entry.skillId), ...(skill ? { catalogId: skill.id } : {}) }];
    }) };
  return filterSourceTrending(validateSourceTrending(feed), policy, skills);
}

export async function refreshSourceTrending({ entries, allTime, skills, policy, outputPath, snapshotDir,
  fetchBoard = () => fetchSkillsShBoard({ board: "trending" }), now = () => new Date().toISOString(),
}: { entries?: SkillsShEntry[];
  /** All-time board (weekly installs) to mark new skills; optional, so its outage still refreshes the list. */
  allTime?: SkillsShEntry[]; skills: LibrarySkill[]; policy: SourceTrendingPolicy; outputPath: string;
  /** Also keep a dated copy (source-trending-YYYY-MM-DD.json) for day-over-day growth. */
  snapshotDir?: string;
  fetchBoard?: () => Promise<{ entries: SkillsShEntry[] }>; now?: () => string }): Promise<SourceTrendingFeed> {
  let feed;
  try {
    const source = entries ?? (await fetchBoard()).entries;
    if (!source.length) throw new Error("Source Trending returned no entries");
    feed = buildSourceTrending(source, skills, policy, now(), allTime);
  } catch (error) {
    if (!isSkillsShUnavailableError(error) || !existsSync(outputPath)) throw error;
    const previous = validateSourceTrending(JSON.parse(readFileSync(outputPath, "utf8")));
    console.warn("[source-unavailable] Keeping source Trending with its original fetch timestamp");
    return previous;
  }
  const bytes = `${JSON.stringify(feed, null, 2)}\n`;
  writeFileSync(`${outputPath}.tmp`, bytes);
  renameSync(`${outputPath}.tmp`, outputPath);
  if (snapshotDir) {
    // One file per UTC day of the fetch; a later run the same day replaces it. Outages keep nothing new.
    mkdirSync(snapshotDir, { recursive: true });
    const snapshotPath = join(snapshotDir, `source-trending-${feed.fetchedAt.slice(0, 10)}.json`);
    writeFileSync(`${snapshotPath}.tmp`, bytes);
    renameSync(`${snapshotPath}.tmp`, snapshotPath);
  }
  return feed;
}

// Seed policy only. The intake reads this feed, so what it blocked must stay in it to be re-checked;
// publication (scripts/prepare-source-trending.mjs) hides intake-blocked entries from the public list.
export function sourceTrendingPolicy() {
  const seeds = loadTrustedSeeds();
  return { blockedRepos: [...(seeds.doNotCrawlRepos ?? [])], blockedOwners: [...(seeds.doNotCrawlOwners ?? [])],
    catalogRepos: seeds.catalogRepoRules.map(rule => rule.repo), suppressedIds: [...(seeds.suppressedSkillIds ?? [])] };
}
