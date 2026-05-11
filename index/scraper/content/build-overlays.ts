import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { buildAuthorProfiles } from "./author-leaderboard-data.js";
import { isTrustedVendor } from "./vendors.js";

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

interface SkillSignal {
  id: string;
  isTrending: boolean;
  trendingRank?: number;
  isOfficial: boolean;
  hasXSignal: boolean;
  xTopTweetLikes?: number;
  xMentionCount?: number;
}

interface AuthorSignal {
  authorHandle: string;
  isOfficialVendor: boolean;
  skillCount: number;
  totalStars: number;
  totalInstalls: number;
  topSkillIds: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const skillsPath = join(root, "skills.json");
const trendingPath = join(root, "trending.json");
const xTrendingPath = join(root, "x-trending.json");
const snapshotsDir = join(root, "snapshots");
const skillSignalsPath = join(root, "skill-signals.json");
const authorSignalsPath = join(root, "author-signals.json");
const snapshotRetentionDays = Number(process.env.SNAPSHOT_RETENTION_DAYS ?? 90);

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeAtomicJson(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tempPath, path);
}

function pruneSnapshots() {
  mkdirSync(snapshotsDir, { recursive: true });
  const cutoffMs = Date.now() - snapshotRetentionDays * 86_400_000;
  let removed = 0;

  for (const entry of readdirSync(snapshotsDir)) {
    const match = entry.match(/^trending-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    const snapshotDate = new Date(`${match[1]}T00:00:00Z`);
    if (Number.isNaN(snapshotDate.getTime())) continue;
    if (snapshotDate.getTime() >= cutoffMs) continue;
    const path = join(snapshotsDir, entry);
    try {
      rmSync(path, { force: true });
      removed++;
    } catch {
      // best effort
    }
  }

  if (removed > 0) {
    console.log(`Pruned ${removed} old snapshots`);
  }
}

function main() {
  const skills = loadJson<Skill[]>(skillsPath);
  const trending = loadJson<TrendingEntry[]>(trendingPath);
  const xTrending = existsSync(xTrendingPath) ? loadJson<Skill[]>(xTrendingPath) : [];

  const trendingById = new Map(trending.map((entry) => [entry.id, entry]));
  const xById = new Map<string, { count: number; topLikes: number }>();

  for (const skill of xTrending) {
    const current = xById.get(skill.id) ?? { count: 0, topLikes: 0 };
    current.count += 1;
    current.topLikes = Math.max(current.topLikes, skill.tweet_likes ?? 0);
    xById.set(skill.id, current);
  }

  const skillSignals: SkillSignal[] = skills.map((skill) => {
    const trendingEntry = trendingById.get(skill.id);
    const xSignal = xById.get(skill.id);
    const signal: SkillSignal = {
      id: skill.id,
      isTrending: Boolean(trendingEntry),
      isOfficial: isTrustedVendor(skill.author_handle),
      hasXSignal: Boolean(xSignal),
    };
    if (trendingEntry) {
      signal.trendingRank = trendingEntry.trending_rank;
    }
    if (xSignal) {
      signal.xMentionCount = xSignal.count;
      signal.xTopTweetLikes = xSignal.topLikes;
    }
    return signal;
  });

  const authors = buildAuthorProfiles(
    skills,
    trending.map((entry) => ({ id: entry.id, installs: entry.installs })),
  );

  const skillsByAuthor = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (!skillsByAuthor.has(skill.author_handle)) {
      skillsByAuthor.set(skill.author_handle, []);
    }
    skillsByAuthor.get(skill.author_handle)!.push(skill);
  }

  const authorSignals: AuthorSignal[] = authors.map((author) => {
    const topSkillIds = (skillsByAuthor.get(author.handle) ?? [])
      .slice()
      .sort((a, b) =>
        b.stars - a.stars ||
        (trendingById.get(b.id)?.installs ?? 0) - (trendingById.get(a.id)?.installs ?? 0) ||
        a.id.localeCompare(b.id),
      )
      .slice(0, 5)
      .map((skill) => skill.id);

    return {
      authorHandle: author.handle,
      isOfficialVendor: author.isVendor,
      skillCount: author.skillCount,
      totalStars: author.totalStars,
      totalInstalls: author.totalInstalls,
      topSkillIds,
    };
  }).sort((a, b) => a.authorHandle.localeCompare(b.authorHandle));

  const skillIdSet = new Set(skills.map((skill) => skill.id));
  for (const signal of skillSignals) {
    if (!skillIdSet.has(signal.id)) {
      throw new Error(`skill-signals cross-link failure: ${signal.id}`);
    }
  }
  for (const author of authorSignals) {
    for (const skillId of author.topSkillIds) {
      if (!skillIdSet.has(skillId)) {
        throw new Error(`author-signals cross-link failure: ${author.authorHandle} -> ${skillId}`);
      }
    }
  }

  writeAtomicJson(skillSignalsPath, skillSignals);
  writeAtomicJson(authorSignalsPath, authorSignals);
  pruneSnapshots();

  console.log(`Written: ${skillSignalsPath}`);
  console.log(`  ${skillSignals.length} skill signals`);
  console.log(`Written: ${authorSignalsPath}`);
  console.log(`  ${authorSignals.length} author signals`);
}

main();
