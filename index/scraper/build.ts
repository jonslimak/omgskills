import { writeFileSync, readFileSync, existsSync, renameSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Skill } from "./types.js";
import { searchByTopics } from "./sources/topics.js";
import { searchBySkillMdFilename } from "./sources/code.js";
import { searchAggregators } from "./sources/aggregators.js";
import { searchSocial } from "./sources/social.js";
import { enrichCandidate, seedRepoCache, type Candidate } from "./enrich.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "skills.json");
const backupPath = join(here, "..", "skills.backup.json");
const cachePath = join(here, "..", "sha-cache.json");

// Atomic write: write to a temp file then rename so a mid-write kill never corrupts the output.
function writeAtomic(path: string, content: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

// SHA cache — stored separately from skills.json so it survives if skills.json is lost/corrupt.
function loadShaCache(): Map<string, string> {
  if (!existsSync(cachePath)) return new Map();
  try {
    const raw = readFileSync(cachePath, "utf8");
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}

function saveShaCache(cache: Map<string, string>) {
  writeAtomic(cachePath, JSON.stringify(Object.fromEntries(cache), null, 2) + "\n");
}

function loadExisting(): { firstSeen: Map<string, string>; skills: Map<string, Skill> } {
  if (!existsSync(outPath)) return { firstSeen: new Map(), skills: new Map() };
  try {
    const raw = readFileSync(outPath, "utf8");
    const arr = JSON.parse(raw) as Skill[];
    return {
      firstSeen: new Map(arr.map((s) => [s.id, s.first_seen])),
      skills: new Map(arr.map((s) => [s.id, s])),
    };
  } catch {
    console.warn("[warn] skills.json is corrupt or missing — loading from SHA cache only");
    return { firstSeen: new Map(), skills: new Map() };
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Back up the current index before touching anything
  if (existsSync(outPath)) {
    copyFileSync(outPath, backupPath);
    console.log(`Backed up skills.json → skills.backup.json`);
  }

  const { firstSeen: existingFirstSeen, skills: existingSkills } = loadExisting();
  const shaCache = loadShaCache();

  // Merge SHAs from sha-cache.json into complete existing skills only.
  // SHA-only cache entries are metadata, not enough to safely reuse parsed skill data.
  for (const [id, sha] of shaCache) {
    const skill = existingSkills.get(id);
    if (skill && !skill.skill_md_sha) {
      existingSkills.set(id, { ...skill, skill_md_sha: sha });
    }
  }

  console.log(`Loaded ${existingSkills.size} skills, ${shaCache.size} SHA cache entries\n`);

  console.log("Fetching discovery sources in parallel...");
  const [topicHits, codeHits, aggregatorHits, socialHits] = await Promise.all([
    searchByTopics(),
    searchBySkillMdFilename(),
    searchAggregators(),
    searchSocial(),
  ]);
  console.log(`  topics:      ${topicHits.length}`);
  console.log(`  code:        ${codeHits.length}`);
  console.log(`  aggregators: ${aggregatorHits.length}`);
  console.log(`  social:      ${socialHits.length}`);

  for (const t of topicHits) {
    seedRepoCache(t.id, {
      stars: t.stars,
      lastUpdated: t.last_updated,
      tags: t.tags,
      githubUrl: t.github_url,
    });
  }

  const candidates = new Map<string, Candidate>();

  for (const c of codeHits) {
    candidates.set(c.id, { id: c.id, skill_md_path: c.path });
  }

  for (const t of topicHits) {
    if (!candidates.has(t.id)) {
      candidates.set(t.id, { id: t.id, skill_md_path: "SKILL.md" });
    }
    const root = candidates.get(t.id)!;
    root.stars = t.stars;
    root.last_updated = t.last_updated;
    root.tags = t.tags;
    root.github_url = t.github_url;
    root.author_handle = t.author_handle;
    root.repo_description = t.repo_description;
  }

  for (const a of aggregatorHits) {
    if (!candidates.has(a.id)) candidates.set(a.id, { id: a.id, skill_md_path: "SKILL.md" });
  }

  for (const s of socialHits) {
    if (!candidates.has(s.id)) candidates.set(s.id, { id: s.id, skill_md_path: "SKILL.md" });
  }

  console.log(`  merged: ${candidates.size} unique candidates\n`);

  const skills: Skill[] = [];
  let skipped = 0;
  let cached = 0;
  let i = 0;
  const total = candidates.size;

  for (const c of candidates.values()) {
    i++;
    const s = await enrichCandidate(c, existingFirstSeen, existingSkills, today);
    if (s) {
      skills.push(s);
      if (s.skill_md_sha && existingSkills.get(c.id)?.skill_md_sha === s.skill_md_sha) cached++;
      // Persist SHA to durable cache every 100 skills
      if (s.skill_md_sha) shaCache.set(s.id, s.skill_md_sha);
      if (skills.length % 100 === 0) saveShaCache(shaCache);
    } else {
      skipped++;
    }
    if (i % 50 === 0 || i === total) {
      console.log(`  enriched ${i}/${total} (kept ${skills.length}, cached ${cached}, skipped ${skipped})`);
    }
  }

  // Carry forward existing skills that weren't rediscovered this run.
  // Skills only leave the index when enrichment explicitly fails (returns null).
  // If a skill was never a candidate, it stays — silently dropping it when code
  // search caps out would shrink the index every run.
  const enrichedIds = new Set(skills.map((s) => s.id));
  let carriedForward = 0;
  for (const [id, existing] of existingSkills) {
    if (!enrichedIds.has(id) && existing.name) {
      skills.push(existing as Skill);
      carriedForward++;
    }
  }

  skills.sort((a, b) => b.stars - a.stars);

  // Sanity check: refuse to overwrite if the new index is <80% of the previous one.
  // This catches discovery regressions before they land.
  const previousCount = existingFirstSeen.size;
  if (previousCount > 0 && skills.length < previousCount * 0.8) {
    console.error(
      `\n[abort] New count (${skills.length}) is less than 80% of previous (${previousCount}). ` +
      `Not overwriting skills.json. Restore from skills.backup.json if needed.`
    );
    process.exit(1);
  }

  // Atomic write — temp file + rename prevents truncated output on kill
  writeAtomic(outPath, JSON.stringify(skills, null, 2) + "\n");
  saveShaCache(shaCache);

  const newCount = skills.filter((s) => !existingFirstSeen.has(s.id)).length;
  console.log(`\nDone. ${skills.length} skills (${newCount} new, ${cached} cached, ${skipped} skipped, ${carriedForward} carried forward).`);
  console.log(`→ ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
