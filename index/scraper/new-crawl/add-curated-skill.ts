import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { enrichCandidate, type Candidate } from "../enrich.js";
import type { Skill } from "../types.js";
import { isUnresolvedCatalogLikeSkill } from "./catalog-policy.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import { resolveShadowProvenance } from "./provenance.js";
import { loadTrustedSeeds } from "./seeds.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import type {
  ShadowCutoverSkillSignal,
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
  ShadowRepoOverlay,
  ShadowSkillOverlay,
  ShadowSkillRecord,
} from "./types.js";

const MANUAL_SOURCE = "manual-curation";

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

function writeShadowJson(path: string, value: unknown): void {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
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

export function upsertShadowSkillOverlay(
  overlay: ShadowSkillOverlay,
  skill: ShadowSkillRecord,
  generatedAt: string,
): ShadowSkillOverlay {
  const byId = new Map(overlay.skills.map((existing) => [existing.id, existing]));
  byId.set(skill.id, skill);
  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { generatedAt, skillCount: skills.length, skills };
}

export function upsertCutoverSkill(skills: ShadowSkillRecord[], skill: ShadowSkillRecord): ShadowSkillRecord[] {
  const byId = new Map(skills.map((existing) => [existing.id, existing]));
  byId.set(skill.id, skill);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function upsertRepoEntry(
  repoIndex: ShadowRepoIndex,
  skill: ShadowSkillRecord,
  parsed: Pick<ParsedGithubSkillUrl, "repoKey" | "repoUrl">,
  generatedAt: string,
): ShadowRepoIndex {
  const byRepo = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));
  const existing = byRepo.get(parsed.repoKey);
  const skillIds = sortUnique([...(existing?.skillIds ?? []), skill.id]);
  const entry: ShadowRepoIndexEntry = {
    repo: parsed.repoKey,
    repoUrl: existing?.repoUrl ?? parsed.repoUrl,
    state: existing?.state ?? "library",
    discoveredSources: sortUnique([...(existing?.discoveredSources ?? []), MANUAL_SOURCE]),
    skillIds,
    skillCount: skillIds.length,
    stars: Math.max(existing?.stars ?? 0, skill.stars),
    lastSeenAt: generatedAt,
    lastRefreshedAt: generatedAt,
    lastCheapCheckedAt: generatedAt,
    lastObservedRepoUpdatedAt: skill.last_updated,
    trustSignals: sortUnique(existing?.trustSignals ?? []),
    promotionReasons: sortUnique([...(existing?.promotionReasons ?? []), MANUAL_SOURCE]),
    staleOrInvalidState: null,
    isTrustedVendor: existing?.isTrustedVendor ?? false,
    isTrustedCreator: existing?.isTrustedCreator ?? false,
    isGoldBasketRepo: existing?.isGoldBasketRepo ?? false,
    topSkillId: existing?.topSkillId && skillIds.includes(existing.topSkillId) ? existing.topSkillId : skill.id,
    topSkillStars: Math.max(existing?.topSkillStars ?? 0, skill.stars),
  };
  byRepo.set(parsed.repoKey, entry);
  const repos = [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
  return { generatedAt, repoCount: repos.length, repos };
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

  const baselineSkillsPath = join(indexRoot, "skills.json");
  const skillOverlayPath = join(shadowRoot, "skills.overlay.json");
  const cutoverSkillsPath = join(shadowRoot, "skills.cutover.shadow.json");
  const repoOverlayPath = join(shadowRoot, "repo-index.overlay.json");
  const repoIndexPath = join(shadowRoot, "repo-index.shadow.json");
  const signalsPath = join(shadowRoot, "skill-signals.cutover.shadow.json");

  const baselineSkills = readJson<Skill[]>(baselineSkillsPath, []);
  const baselineIds = new Set(baselineSkills.map((skill) => skill.id));
  if (baselineIds.has(parsed.skillId)) {
    throw new Error(`Skill already exists in production skills.json: ${parsed.skillId}`);
  }

  const skillOverlay = readJson<ShadowSkillOverlay>(skillOverlayPath, { generatedAt, skillCount: 0, skills: [] });
  const cutoverSkills = readJson<ShadowSkillRecord[]>(cutoverSkillsPath, []);
  if (cutoverSkills.length === 0) {
    throw new Error("Missing shadow/skills.cutover.shadow.json. Run a Crawl 4 shadow crawl once before manual curation.");
  }

  const priorSkills = [...baselineSkills, ...skillOverlay.skills, ...cutoverSkills];
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

  const shadowSkill = toShadowSkillRecord(enriched.skill);
  if (isUnresolvedCatalogLikeSkill(shadowSkill)) {
    throw new Error(`Blocked unresolved catalog/repackaged skill: ${shadowSkill.id}`);
  }

  const repoOverlay = readJson<ShadowRepoOverlay>(repoOverlayPath, { generatedAt, repoCount: 0, repos: [] });
  const repoIndex = readJson<ShadowRepoIndex>(repoIndexPath, { generatedAt, repoCount: 0, repos: [] });
  const signals = readJson<ShadowCutoverSkillSignal[]>(signalsPath, []);

  const nextOverlay = upsertShadowSkillOverlay(skillOverlay, shadowSkill, generatedAt);
  const nextCutoverSkills = upsertCutoverSkill(cutoverSkills, shadowSkill);
  const nextRepoOverlay = upsertRepoEntry(repoOverlay, shadowSkill, parsed, generatedAt);
  const nextRepoIndex = upsertRepoEntry(repoIndex, shadowSkill, parsed, generatedAt);
  const validationFailures = validateCutoverOutputs(nextCutoverSkills, signals, nextRepoIndex);
  if (validationFailures.length > 0) {
    throw new Error(`Manual curation would break cutover validation: ${validationFailures[0]?.details}`);
  }

  writeShadowJson(skillOverlayPath, nextOverlay);
  writeShadowJson(cutoverSkillsPath, nextCutoverSkills);
  writeShadowJson(repoOverlayPath, nextRepoOverlay);
  writeShadowJson(repoIndexPath, nextRepoIndex);

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
