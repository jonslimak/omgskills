import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canKeepLastGoodSkillsShData,
  fetchSkillsShInstallTotals,
  searchSkillsSh,
} from "./sources/skillssh.js";
import type { SkillsShHit } from "./sources/skillssh.js";

// Rank by skills.sh's trending board (recent installs), but keep lifetime install totals for the
// "installs" counts that skill pages, the Mac app and search signals display.
const RANK_BOARD = "trending" as const;
import type { Skill } from "./types.js";

interface TrendingEntry {
  id: string;
  installs: number;
  /** Original rank returned by the skills.sh board, before display diversification. */
  source_rank?: number;
  trending_rank: number;
  trending_source: string;
  /** skills.sh board the rank came from; files written before 2026-10-19 used "all-time". */
  board?: "all-time" | "trending" | "hot";
}

const here = dirname(fileURLToPath(import.meta.url));
const skillsPath   = join(here, "..", "skills.json");
const outPath      = join(here, "..", "trending.json");
const backupPath   = join(here, "..", "trending.backup.json");
const snapshotsDir = join(here, "..", "snapshots");

function writeAtomic(path: string, content: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function loadExisting(): { entries: Map<string, TrendingEntry>; lightweight: boolean } {
  if (!existsSync(outPath)) return { entries: new Map(), lightweight: true };
  try {
    const arr = JSON.parse(readFileSync(outPath, "utf8")) as Array<Record<string, unknown>>;
    const lightweight = arr.every((entry) =>
      typeof entry.id === "string" &&
      typeof entry.installs === "number" &&
      typeof entry.trending_rank === "number" &&
      typeof entry.trending_source === "string" &&
      !("name" in entry)
    );
    if (!lightweight) return { entries: new Map(), lightweight: false };
    const entries = arr as unknown as TrendingEntry[];
    return {
      entries: new Map(entries.map((s) => [s.id, s])),
      lightweight,
    };
  } catch {
    return { entries: new Map(), lightweight: true };
  }
}

interface TrendingSourceDependencies {
  search: () => Promise<SkillsShHit[]>;
  fetchInstallTotals: () => Promise<Map<string, number>>;
  warn: (message: string) => void;
}

export async function loadTrendingSourceData(
  dependencies: TrendingSourceDependencies = {
    search: () => searchSkillsSh({ board: RANK_BOARD }),
    fetchInstallTotals: () => fetchSkillsShInstallTotals(),
    warn: console.warn,
  },
): Promise<{ hits: SkillsShHit[]; totals: Map<string, number> }> {
  const hits = await dependencies.search();
  try {
    return { hits, totals: await dependencies.fetchInstallTotals() };
  } catch (error) {
    dependencies.warn(
      `[optional-source-unavailable] lifetime install totals unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { hits, totals: new Map() };
  }
}

export function installCountForTrendingHit(
  hit: SkillsShHit,
  totals: Map<string, number>,
  existing: Map<string, TrendingEntry>,
): number {
  const lifetimeInstalls = totals.get(hit.id.toLowerCase()) ?? existing.get(hit.id)?.installs;
  return Math.max(lifetimeInstalls ?? 0, hit.installs);
}

/** Extra skills from one repo past the first few would crowd the top of the list. */
export const TRENDING_PER_REPO = 2;

// Keep every entry, but move each repo's skills past the cap below the rest, then renumber
// ranks 1..n so every consumer that sorts by trending_rank sees the varied order.
export function spreadTrendingByRepo<T extends { id: string; trending_rank: number }>(
  entries: T[],
  perRepo = TRENDING_PER_REPO,
): T[] {
  const seen = new Map<string, number>();
  const head: T[] = [];
  const tail: T[] = [];
  for (const entry of entries) {
    const repo = entry.id.split(":")[0].toLowerCase();
    const count = seen.get(repo) ?? 0;
    seen.set(repo, count + 1);
    (count < perRepo ? head : tail).push(entry);
  }
  return [...head, ...tail].map((entry, index) => ({ ...entry, trending_rank: index + 1 }));
}

export function isUnsafeTrendingShrink(previousCount: number, nextCount: number): boolean {
  return previousCount > 0 && nextCount < previousCount / 2;
}

function loadMainLibrary(): Map<string, Skill> {
  if (!existsSync(skillsPath)) {
    throw new Error("skills.json missing — run the main scrape first");
  }
  const arr = JSON.parse(readFileSync(skillsPath, "utf8")) as Skill[];
  return new Map(arr.map((skill) => [skill.id, skill]));
}

async function main() {
  if (existsSync(outPath)) {
    copyFileSync(outPath, backupPath);
    console.log("Backed up trending.json → trending.backup.json");
  }

  const existing = loadExisting();
  const library = loadMainLibrary();
  console.log(`Loaded ${library.size} library skills`);

  let hits;
  let totals: Map<string, number>;
  try {
    ({ hits, totals } = await loadTrendingSourceData());
  } catch (error) {
    if (!canKeepLastGoodSkillsShData(error, existing.entries.size)) throw error;
    console.warn(
      `[source-unavailable] ${error instanceof Error ? error.message : String(error)}; ` +
      `keeping ${existing.entries.size} last-good trending entries`,
    );
    return;
  }
  console.log(`  trending candidates: ${hits.length}`);

  let entries: TrendingEntry[] = [];
  let skippedMissing = 0;

  for (const hit of hits) {
    if (!library.has(hit.id)) {
      skippedMissing++;
      continue;
    }

    entries.push({
      id: hit.id,
      // Lifetime total when skills.sh lists it; otherwise the trending-board count (a lower bound).
      installs: installCountForTrendingHit(hit, totals, existing.entries),
      source_rank: hit.trending_rank,
      trending_rank: hit.trending_rank,
      trending_source: hit.trending_source,
      board: RANK_BOARD,
    });

    if (entries.length % 50 === 0) {
      console.log(`  kept ${entries.length}/${hits.length} (missing from library ${skippedMissing})`);
    }
  }

  entries.sort((a, b) => a.trending_rank - b.trending_rank || b.installs - a.installs);
  entries = spreadTrendingByRepo(entries);

  const previousCount = existing.entries.size;
  if (existing.lightweight && isUnsafeTrendingShrink(previousCount, entries.length)) {
    console.error(`[abort] Trending output dropped from ${previousCount} to ${entries.length}; keeping last good trending.json`);
    process.exit(1);
  }

  writeAtomic(outPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`Done. ${entries.length} trending entries (${skippedMissing} missing from library).`);
  console.log(`→ ${outPath}`);

  // ── Save dated snapshot ──────────────────────────────────────────────────
  // Keeps a permanent record per day so we can compute week-over-week growth.
  // File: snapshots/trending-YYYY-MM-DD.json
  mkdirSync(snapshotsDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const snapshotPath = join(snapshotsDir, `trending-${today}.json`);
  const snapshotData = JSON.stringify(
    { date: today, entries },
    null, 2,
  ) + "\n";
  writeFileSync(snapshotPath, snapshotData, "utf8");
  console.log(`→ snapshot saved: snapshots/trending-${today}.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
