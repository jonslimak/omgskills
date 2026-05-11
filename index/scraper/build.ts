import { writeFileSync, readFileSync, existsSync, renameSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Skill } from "./types.js";
import { searchByTopics } from "./sources/topics.js";
import { searchBySkillMdFilename } from "./sources/code.js";
import { searchAggregators } from "./sources/aggregators.js";
import { searchSocial } from "./sources/social.js";
import { searchRegistry } from "./sources/registry.js";
import { searchSkillsSh } from "./sources/skillssh.js";
import { searchAwesomeAgentSkills } from "./sources/awesome.js";
import { searchOfficialSkills } from "./sources/official.js";
import { enrichCandidate, seedRepoCache, type Candidate } from "./enrich.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "skills.json");
const backupPath = join(here, "..", "skills.backup.json");
const cachePath = join(here, "..", "sha-cache.json");
const CHECKPOINT_INTERVAL = 500;
const MIN_STARS_FOR_NEW_SKILLS = 3;
const SKILLS_SH_MIN_REPO_STARS = 50;
const BLOCKED_REPOS = new Set([
  "majiayu000/claude-skill-registry",
  "majiayu000/claude-skill-registry-data",
  "supercent-io/skills-template",
]);
const X_SOURCE_TAG = "x-top-skill-tweet";

// Atomic write: write to a temp file then rename so a mid-write kill never corrupts the output.
function writeAtomic(path: string, content: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function stringifySkills(skills: Skill[]) {
  return JSON.stringify(skills, (key, value) => key === "readme_snippet" ? undefined : value, 2) + "\n";
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

function skillRepoPathKey(skill: Skill): string | null {
  if (!skill.github_url) return null;
  const githubUrl = skill.github_url.replace(/\/+$/, "").toLowerCase();
  if (skill.skill_md_path) {
    return `${githubUrl}::${skill.skill_md_path.trim().toLowerCase()}`;
  }
  const installMatch = skill.install_cmd.match(/ln -s \S+\/(.+?) ~\/\.claude\/skills\//);
  if (installMatch?.[1]) {
    return `${githubUrl}::${installMatch[1].trim().toLowerCase()}/SKILL.md`;
  }
  return null;
}

function dedupeSkills(skills: Skill[]): { skills: Skill[]; removed: number } {
  const seenIds = new Set<string>();
  const seenRepoPaths = new Set<string>();
  const deduped: Skill[] = [];
  let removed = 0;

  for (const skill of skills) {
    if (seenIds.has(skill.id)) {
      removed++;
      continue;
    }
    const repoPathKey = skillRepoPathKey(skill);
    if (repoPathKey && seenRepoPaths.has(repoPathKey)) {
      removed++;
      continue;
    }
    seenIds.add(skill.id);
    if (repoPathKey) seenRepoPaths.add(repoPathKey);
    deduped.push(skill);
  }

  return { skills: deduped, removed };
}

function buildSnapshot(skills: Skill[], existingSkills: Map<string, Skill>): Skill[] {
  const snapshot = [...skills];
  const seenIds = new Set(snapshot.map((s) => s.id));
  for (const [id, existing] of existingSkills) {
    if (!seenIds.has(id) && existing.name) snapshot.push(existing as Skill);
  }
  snapshot.sort((a, b) => b.stars - a.stars);
  return dedupeSkills(snapshot).skills;
}

function saveCheckpoint(skills: Skill[], existingSkills: Map<string, Skill>, shaCache: Map<string, string>) {
  const snapshot = buildSnapshot(skills, existingSkills);
  writeAtomic(outPath, stringifySkills(snapshot));
  saveShaCache(shaCache);
  return snapshot.length;
}

function loadExisting(): { firstSeen: Map<string, string>; skills: Map<string, Skill> } {
  if (!existsSync(outPath)) return { firstSeen: new Map(), skills: new Map() };
  try {
    const raw = readFileSync(outPath, "utf8");
    const arr = (JSON.parse(raw) as Skill[]).filter((s) => s.source_tag !== X_SOURCE_TAG);
    return {
      firstSeen: new Map(arr.map((s) => [s.id, s.first_seen])),
      skills: new Map(arr.map((s) => [s.id, s])),
    };
  } catch {
    console.warn("[warn] skills.json is corrupt or missing — loading from SHA cache only");
    return { firstSeen: new Map(), skills: new Map() };
  }
}

function repoFromId(id: string): string {
  return id.includes(":") ? id.split(":")[0] : id;
}

function isBlockedId(id: string): boolean {
  return BLOCKED_REPOS.has(repoFromId(id));
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
  const [topicHits, codeHits, aggregatorHits, socialHits, registryHits, skillsShHits, awesomeHits, officialHits] = await Promise.all([
    searchByTopics(),
    searchBySkillMdFilename(),
    searchAggregators(),
    searchSocial(),
    searchRegistry(),
    searchSkillsSh({
      board: "all-time",
      crawlAll: true,
      minRepoStars: SKILLS_SH_MIN_REPO_STARS,
      pageConcurrency: 1,
      repoConcurrency: 8,
    }),
    searchAwesomeAgentSkills(),
    searchOfficialSkills(),
  ]);
  console.log(`  topics:      ${topicHits.length}`);
  console.log(`  code:        ${codeHits.length}`);
  console.log(`  aggregators: ${aggregatorHits.length}`);
  console.log(`  social:      ${socialHits.length}`);
  console.log(`  registry:    ${registryHits.length}`);
  console.log(`  skills.sh:   ${skillsShHits.length}`);
  console.log(`  awesome:     ${awesomeHits.length}`);
  console.log(`  official:    ${officialHits.length}`);

  for (const t of topicHits) {
    if (isBlockedId(t.id)) continue;
    seedRepoCache(t.id, {
      stars: t.stars,
      lastUpdated: t.last_updated,
      tags: t.tags,
      githubUrl: t.github_url,
    });
  }

  const candidates = new Map<string, Candidate>();

  for (const c of codeHits) {
    if (isBlockedId(c.id)) continue;
    candidates.set(c.id, { id: c.id, skill_md_path: c.path });
  }

  for (const t of topicHits) {
    if (isBlockedId(t.id)) continue;
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
    if (isBlockedId(a.id)) continue;
    if (!candidates.has(a.id)) candidates.set(a.id, { id: a.id, skill_md_path: "SKILL.md" });
  }

  for (const s of socialHits) {
    if (isBlockedId(s.id)) continue;
    if (!candidates.has(s.id)) candidates.set(s.id, { id: s.id, skill_md_path: "SKILL.md" });
  }

  for (const r of registryHits) {
    if (isBlockedId(r.id)) continue;
    if (!candidates.has(r.id)) {
      candidates.set(r.id, {
        id: r.id,
        skill_md_path: r.path,
        ref: r.ref,
        stars: r.stars,
        tags: r.tags,
        github_url: r.github_url,
        author_handle: r.author_handle,
      });
    }
  }

  for (const s of skillsShHits) {
    if (isBlockedId(s.id)) continue;
    if (!candidates.has(s.id)) {
      candidates.set(s.id, {
        id: s.id,
        skill_md_path: s.path,
        skill_name_hint: s.skill_name_hint,
        github_url: s.github_url,
        author_handle: s.author_handle,
      });
    }
  }

  for (const a of awesomeHits) {
    if (isBlockedId(a.id)) continue;
    if (!candidates.has(a.id)) {
      candidates.set(a.id, {
        id: a.id,
        skill_md_path: a.path,
        skill_name_hint: a.skill_name_hint,
        ref: a.ref,
        github_url: a.github_url,
        author_handle: a.author_handle,
      });
    }
  }

  for (const o of officialHits) {
    if (isBlockedId(o.id)) continue;
    if (!candidates.has(o.id)) {
      candidates.set(o.id, {
        id: o.id,
        skill_md_path: o.path,
        skill_name_hint: o.skill_name_hint,
        github_url: o.github_url,
        author_handle: o.author_handle,
      });
    }
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
      const isExisting = existingFirstSeen.has(s.id);
      if (!isExisting && s.stars < MIN_STARS_FOR_NEW_SKILLS) {
        skipped++;
        continue;
      }
      skills.push(s);
      if (s.skill_md_sha && existingSkills.get(c.id)?.skill_md_sha === s.skill_md_sha) cached++;
      // Persist SHA to durable cache as we go, and checkpoint the index periodically.
      if (s.skill_md_sha) shaCache.set(s.id, s.skill_md_sha);
      if (skills.length % 100 === 0) saveShaCache(shaCache);
      if (skills.length % CHECKPOINT_INTERVAL === 0) {
        const count = saveCheckpoint(skills, existingSkills, shaCache);
        console.log(`  checkpointed ${skills.length} enriched skills (${count} total written)`);
      }
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
  const deduped = dedupeSkills(skills);

  // Sanity check: refuse to overwrite if the new index is <80% of the previous one.
  // This catches discovery regressions before they land.
  const previousCount = existingFirstSeen.size;
  if (previousCount > 0 && deduped.skills.length < previousCount * 0.8) {
    console.error(
      `\n[abort] New count (${deduped.skills.length}) is less than 80% of previous (${previousCount}). ` +
      `Not overwriting skills.json. Restore from skills.backup.json if needed.`
    );
    process.exit(1);
  }

  // Atomic write — temp file + rename prevents truncated output on kill
  writeAtomic(outPath, stringifySkills(deduped.skills));
  saveShaCache(shaCache);

  const newCount = deduped.skills.filter((s) => !existingFirstSeen.has(s.id)).length;
  console.log(`\nDone. ${deduped.skills.length} skills (${newCount} new, ${cached} cached, ${skipped} skipped, ${carriedForward} carried forward, ${deduped.removed} deduped).`);
  console.log(`→ ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
