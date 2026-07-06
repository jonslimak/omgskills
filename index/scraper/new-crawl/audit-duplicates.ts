import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import type { ProvenanceType, ShadowSkillRecord } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const indexRoot = join(__filename, "..", "..", "..");
const DEFAULT_SKILLS_PATH = join(indexRoot, "shadow", "skills.cutover.shadow.json");
const FALLBACK_SKILLS_PATH = join(indexRoot, "skills.json");
const SAMPLE_LIMIT = 8;
const CLUSTER_LIMIT = 20;

export type DuplicateAuditSkill = Pick<
  Skill,
  "id" | "name" | "github_url" | "install_cmd" | "author_handle" | "stars"
> & {
  skill_md_sha?: string | null;
  provenance_type?: ProvenanceType;
};

export type DuplicateAuditCategory = "skill_md_sha" | "author_name" | "install_cmd" | "repo_name";

export type DuplicateAuditSkillSample = {
  id: string;
  name: string;
  github_url: string;
  author_handle: string;
  provenance_type: ProvenanceType | "unknown";
  stars: number;
};

export type DuplicateAuditCluster = {
  key: string;
  count: number;
  samples: DuplicateAuditSkillSample[];
};

export type DuplicateAuditCategoryResult = {
  category: DuplicateAuditCategory;
  clusterCount: number;
  affectedSkillCount: number;
  clusters: DuplicateAuditCluster[];
};

export type DuplicateAuditResult = {
  skillCount: number;
  categories: DuplicateAuditCategoryResult[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCommand(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function repoFromGithubUrl(value: string): string {
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return "";
  return `${match[1]!.toLowerCase()}/${match[2]!.replace(/\.git$/i, "").toLowerCase()}`;
}

function sampleSkill(skill: DuplicateAuditSkill): DuplicateAuditSkillSample {
  return {
    id: skill.id,
    name: skill.name,
    github_url: skill.github_url,
    author_handle: skill.author_handle,
    provenance_type: skill.provenance_type ?? "unknown",
    stars: skill.stars,
  };
}

function buildClusters(
  category: DuplicateAuditCategory,
  skills: DuplicateAuditSkill[],
  keyForSkill: (skill: DuplicateAuditSkill) => string,
): DuplicateAuditCategoryResult {
  const grouped = new Map<string, DuplicateAuditSkill[]>();

  for (const skill of skills) {
    const key = keyForSkill(skill);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(skill);
    grouped.set(key, rows);
  }

  const clusters = [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      samples: rows
        .sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id))
        .slice(0, SAMPLE_LIMIT)
        .map(sampleSkill),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    category,
    clusterCount: clusters.length,
    affectedSkillCount: clusters.reduce((sum, cluster) => sum + cluster.count, 0),
    clusters: clusters.slice(0, CLUSTER_LIMIT),
  };
}

export function buildDuplicateAudit(skills: DuplicateAuditSkill[]): DuplicateAuditResult {
  return {
    skillCount: skills.length,
    categories: [
      buildClusters("skill_md_sha", skills, (skill) => normalizeText(skill.skill_md_sha)),
      buildClusters("author_name", skills, (skill) => {
        const author = normalizeText(skill.author_handle);
        const name = normalizeText(skill.name);
        return author && name ? `${author}\t${name}` : "";
      }),
      buildClusters("install_cmd", skills, (skill) => normalizeCommand(skill.install_cmd)),
      buildClusters("repo_name", skills, (skill) => {
        const repo = repoFromGithubUrl(skill.github_url);
        const name = normalizeText(skill.name);
        return repo && name ? `${repo}\t${name}` : "";
      }),
    ],
  };
}

function loadSkills(): { path: string; skills: DuplicateAuditSkill[] } {
  const path = existsSync(DEFAULT_SKILLS_PATH) ? DEFAULT_SKILLS_PATH : FALLBACK_SKILLS_PATH;
  const skills = JSON.parse(readFileSync(path, "utf8")) as ShadowSkillRecord[];
  return { path, skills };
}

function printAudit(sourcePath: string, audit: DuplicateAuditResult): void {
  console.log(`duplicate audit source: ${sourcePath}`);
  console.log(`skills: ${audit.skillCount}`);
  for (const category of audit.categories) {
    console.log("");
    console.log(`## ${category.category}`);
    console.log(`clusters: ${category.clusterCount}`);
    console.log(`affected skills: ${category.affectedSkillCount}`);
    for (const cluster of category.clusters) {
      console.log(`- ${cluster.key} (${cluster.count})`);
      for (const sample of cluster.samples) {
        console.log(
          `  - ${sample.id} | @${sample.author_handle || "?"} | ${sample.provenance_type} | stars=${sample.stars} | ${sample.github_url}`,
        );
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { path, skills } = loadSkills();
  printAudit(path, buildDuplicateAudit(skills));
}
