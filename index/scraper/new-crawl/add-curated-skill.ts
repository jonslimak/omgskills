import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { enrichCandidate, type Candidate } from "../enrich.js";
import type { Skill } from "../types.js";
import { normalizePolicySkillId } from "../../../scripts/policy-identifiers.mjs";
import { evaluateEffectiveSkillPolicy, repoFromGithubUrl } from "../policy/effective-policy.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import { resolveShadowProvenance } from "./provenance.js";
import { loadTrustedSeeds } from "./seeds.js";
import { indexRoot } from "./shadow-path-guard.js";
import {
  commitShadowSkillPersistence,
  loadShadowSkillPersistenceSnapshot,
  MANUAL_CURATION_SOURCE,
  prepareShadowSkillPersistence,
} from "./shadow-skill-persistence.js";
import type {
  ShadowSkillRecord,
  TrustedSeeds,
} from "./types.js";

export { upsertCutoverSkill, upsertRepoEntry, upsertShadowSkillOverlay } from "./shadow-skill-persistence.js";

export type ParsedGithubSkillUrl = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  repoKey: string;
  repoUrl: string;
  skillId: string;
};

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function normalizeSkillSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function skillSlugFromPath(path: string, repo: string): string {
  if (path.toLowerCase() === "skill.md") return normalizeSkillSlug(repo);
  const parts = path.split("/").filter(Boolean);
  const parent = parts.length >= 2 ? parts[parts.length - 2] : basename(path, ".md");
  return normalizeSkillSlug(parent ?? repo);
}

export function parseGithubSkillUrl(input: string): ParsedGithubSkillUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected a GitHub SKILL.md URL.");
  }

  if (url.hostname !== "github.com") {
    throw new Error("Expected a github.com URL.");
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const blobIndex = parts.indexOf("blob");
  if (parts.length < 5 || blobIndex !== 2) {
    throw new Error("Expected a GitHub blob URL like https://github.com/owner/repo/blob/main/path/SKILL.md.");
  }

  const [owner, repo] = parts;
  const ref = parts[blobIndex + 1];
  const path = parts.slice(blobIndex + 2).join("/");
  if (!owner || !repo || !ref || !path) {
    throw new Error("Could not parse owner, repo, ref, and SKILL.md path from URL.");
  }
  if (!path.toLowerCase().endsWith("skill.md")) {
    throw new Error("Manual curation currently accepts exact SKILL.md links only.");
  }

  const repoKey = `${owner}/${repo}`.toLowerCase();
  const slug = skillSlugFromPath(path, repo);
  if (!slug) throw new Error("Could not derive a stable skill id from the SKILL.md path.");

  return {
    owner,
    repo,
    ref,
    path,
    repoKey,
    repoUrl: `https://github.com/${owner}/${repo}`,
    skillId: `${owner}/${repo}:${slug}`,
  };
}

export function assertManualCandidateAllowed(parsed: ParsedGithubSkillUrl, seeds: TrustedSeeds): void {
  const decision = evaluateEffectiveSkillPolicy({ id: parsed.skillId, github_url: parsed.repoUrl }, seeds);
  if (decision.excluded) {
    throw new Error(`Manual curation blocked by ${decision.reasonCode}: ${decision.matchedKey ?? parsed.skillId}`);
  }
  if (isKnownCatalogRepo(parsed.repoKey, seeds.catalogRepoRules)) {
    throw new Error(`Manual curation blocked by catalog policy: ${parsed.repoKey}`);
  }
  const normalizedId = normalizePolicySkillId(parsed.skillId);
  const unsafeOverride = seeds.provenanceOverrides.find((entry) =>
    (entry.id && normalizePolicySkillId(entry.id) === normalizedId) || entry.repo === parsed.repoKey
  );
  if (unsafeOverride?.provenanceType && unsafeOverride.provenanceType !== "original") {
    throw new Error(`Manual curation blocked by non-original provenance: ${parsed.skillId}`);
  }
}

function normalizedPath(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\.\//, "").toLowerCase();
}

export function findIdempotentManualSkill(
  parsed: ParsedGithubSkillUrl,
  skills: Skill[],
): Skill | null {
  const normalizedId = normalizePolicySkillId(parsed.skillId);
  const existing = skills.find((skill) => normalizePolicySkillId(skill.id) === normalizedId);
  if (!existing) return null;
  const sameRepo = repoFromGithubUrl(existing.github_url) === parsed.repoKey;
  const samePath = normalizedPath(existing.skill_md_path) === normalizedPath(parsed.path);
  if (sameRepo && samePath) return existing;
  throw new Error(
    `Manual curation id conflict for ${parsed.skillId}: existing row points to ${existing.github_url}#${existing.skill_md_path ?? "unknown"}.`,
  );
}

export function toShadowSkillRecord(skill: Skill, seeds = loadTrustedSeeds("manual-command")): ShadowSkillRecord {
  const provenance = resolveShadowProvenance(skill, seeds);
  return {
    ...skill,
    author_handle: provenance.authorHandle,
    publisher_handle: provenance.publisherHandle,
    publisher_repo: provenance.publisherRepo,
    upstream_repo: provenance.upstreamRepo,
    provenance_type: provenance.provenanceType,
    author_confidence: provenance.authorConfidence,
  };
}

function existingFirstSeen(skills: Skill[]): Map<string, string> {
  return new Map(skills.map((skill) => [skill.id, skill.first_seen]));
}

function existingSkillMap(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((skill) => [skill.id, skill]));
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error("Usage: npm run crawl4:add-skill -- <github-blob-skill-md-url>");
  }

  const generatedAt = new Date().toISOString();
  const today = generatedAt.slice(0, 10);
  const parsed = parseGithubSkillUrl(input);
  const seeds = loadTrustedSeeds("manual-command");
  assertManualCandidateAllowed(parsed, seeds);

  const baselineSkillsPath = join(indexRoot, "skills.json");
  const baselineSkills = readJson<Skill[]>(baselineSkillsPath, []);
  const snapshot = loadShadowSkillPersistenceSnapshot(undefined, generatedAt);
  if (snapshot.cutoverSkills.length === 0) {
    throw new Error("Missing shadow/skills.cutover.shadow.json. Run a Crawl 4 shadow crawl once before manual curation.");
  }

  const priorSkills = [...baselineSkills, ...snapshot.skillOverlay.skills, ...snapshot.cutoverSkills];
  const existing = findIdempotentManualSkill(parsed, priorSkills);
  if (existing) {
    console.log(`already present: ${existing.id}`);
    return;
  }
  const candidate: Candidate = {
    id: parsed.skillId,
    skill_md_path: parsed.path,
    ref: parsed.ref,
    github_url: parsed.repoUrl,
  };
  const enriched = await enrichCandidate(candidate, existingFirstSeen(priorSkills), existingSkillMap(priorSkills), today);
  if (!enriched.skill) {
    throw new Error(`Could not enrich ${parsed.skillId}. The SKILL.md must parse cleanly with name and description.`);
  }

  const shadowSkill = toShadowSkillRecord(enriched.skill, seeds);
  if (shadowSkill.provenance_type !== "original") {
    throw new Error(`Manual curation blocked by non-original provenance: ${shadowSkill.id}`);
  }

  const prepared = prepareShadowSkillPersistence({
    snapshot,
    additions: [{
      skill: shadowSkill,
      repoKey: parsed.repoKey,
      repoUrl: parsed.repoUrl,
      source: MANUAL_CURATION_SOURCE,
    }],
    generatedAt,
  });
  commitShadowSkillPersistence({ snapshot, prepared });

  console.log(`added ${shadowSkill.id}`);
  console.log(`name: ${shadowSkill.name}`);
  console.log(`repo: ${parsed.repoKey}`);
  console.log(`path: ${shadowSkill.skill_md_path ?? parsed.path}`);
  console.log("next: publish Crawl 4 test data when ready");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
