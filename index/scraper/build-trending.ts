import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchSkillsSh } from "./sources/skillssh.js";
import type { Skill } from "./types.js";

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
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

  const hits = await searchSkillsSh();
  console.log(`  trending candidates: ${hits.length}`);

  const entries: TrendingEntry[] = [];
  let skippedMissing = 0;

  for (const hit of hits) {
    if (!library.has(hit.id)) {
      skippedMissing++;
      continue;
    }

    entries.push({
      id: hit.id,
      installs: hit.installs,
      trending_rank: hit.trending_rank,
      trending_source: hit.trending_source,
    });

    if (entries.length % 50 === 0) {
      console.log(`  kept ${entries.length}/${hits.length} (missing from library ${skippedMissing})`);
    }
  }

  entries.sort((a, b) => a.trending_rank - b.trending_rank || b.installs - a.installs);

  const previousCount = existing.entries.size;
  if (existing.lightweight && previousCount > 0 && entries.length < previousCount / 2) {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
