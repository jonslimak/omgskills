import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

interface TrendingLeaderboardRecord {
  rank: number;
  id: string;
  name: string;
  authorHandle: string;
  description: string;
  stars: number;
  installs: number;
  githubUrl: string;
  source: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const skillsPath = join(root, "skills.json");
const snapshotsDir = join(root, "snapshots");
const outPath = join(root, "trending-leaderboard.json");

function writeAtomicJson(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tempPath, path);
}

function latestSnapshotPath(): string {
  if (!existsSync(snapshotsDir)) {
    throw new Error("No snapshots directory found. Run npm run scrape:trending first.");
  }
  const latest = readdirSync(snapshotsDir)
    .filter((file) => /^trending-\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .at(-1);
  if (!latest) {
    throw new Error("No trending snapshots found. Run npm run scrape:trending first.");
  }
  return join(snapshotsDir, latest);
}

function main() {
  const skills = JSON.parse(readFileSync(skillsPath, "utf8")) as Skill[];
  const snapshot = JSON.parse(readFileSync(latestSnapshotPath(), "utf8")) as {
    date: string;
    entries: TrendingEntry[];
  };
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

  const records: TrendingLeaderboardRecord[] = snapshot.entries
    .slice()
    .sort((a, b) => a.trending_rank - b.trending_rank)
    .map((entry, index) => {
      const skill = skillsById.get(entry.id);
      if (!skill) return null;
      return {
        rank: index + 1,
        id: entry.id,
        name: skill.name,
        authorHandle: skill.author_handle,
        description: skill.description,
        stars: skill.stars,
        installs: entry.installs,
        githubUrl: skill.github_url,
        source: entry.trending_source,
      };
    })
    .filter((record): record is TrendingLeaderboardRecord => record !== null);

  writeAtomicJson(outPath, records);
  console.log(`✓ Wrote ${records.length} trending leaderboard records from ${snapshot.date} to ${outPath}`);
}

main();
