import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Skill } from "./types.js";
import { searchByTopics } from "./sources/topics.js";
import { searchBySkillMdFilename } from "./sources/code.js";
import { enrichCandidate, type Candidate } from "./enrich.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "skills.json");

function loadExistingFirstSeen(): Map<string, string> {
  if (!existsSync(outPath)) return new Map();
  try {
    const raw = readFileSync(outPath, "utf8");
    const arr = JSON.parse(raw) as Skill[];
    return new Map(arr.map((s) => [s.id, s.first_seen]));
  } catch {
    return new Map();
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const existingFirstSeen = loadExistingFirstSeen();

  console.log("Fetching topic hits + code hits in parallel...");
  const [topicHits, codeHits] = await Promise.all([
    searchByTopics(),
    searchBySkillMdFilename(),
  ]);
  console.log(`  topics: ${topicHits.length}`);
  console.log(`  code:   ${codeHits.length}`);

  const candidates = new Map<string, Candidate>();
  for (const c of codeHits) {
    candidates.set(c.id, { id: c.id, skill_md_path: c.path });
  }
  for (const t of topicHits) {
    const existing = candidates.get(t.id) ?? { id: t.id, skill_md_path: "SKILL.md" };
    candidates.set(t.id, {
      ...existing,
      stars: t.stars,
      last_updated: t.last_updated,
      tags: t.tags,
      github_url: t.github_url,
      author_handle: t.author_handle,
      repo_description: t.repo_description,
    });
  }
  console.log(`  merged: ${candidates.size} unique repos\n`);

  const skills: Skill[] = [];
  let skipped = 0;
  let i = 0;
  const total = candidates.size;

  for (const c of candidates.values()) {
    i++;
    const s = await enrichCandidate(c, existingFirstSeen, today);
    if (s) {
      skills.push(s);
    } else {
      skipped++;
    }
    if (i % 10 === 0 || i === total) {
      console.log(`  enriched ${i}/${total} (kept ${skills.length}, skipped ${skipped})`);
    }
  }

  skills.sort((a, b) => b.stars - a.stars);

  writeFileSync(outPath, JSON.stringify(skills, null, 2) + "\n");

  const newCount = skills.filter((s) => !existingFirstSeen.has(s.id)).length;
  console.log(`\nDone. ${skills.length} skills (${newCount} new, ${skipped} skipped).`);
  console.log(`→ ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
