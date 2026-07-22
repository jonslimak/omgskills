import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateCutoverOutputs } from "./cutover-validation.js";
import { normalizeRepoKey, repoFromSkillId } from "./do-not-crawl.js";
import { loadTrustedSeeds } from "./seeds.js";
import { indexRoot, shadowRoot, assertShadowPath } from "./shadow-path-guard.js";
import type {
  DoNotCrawlReason,
  DoNotCrawlRule,
  ShadowCutoverSkillSignal,
  ShadowRepoIndex,
  ShadowRepoOverlay,
  ShadowSkillOverlay,
  ShadowSkillRecord,
} from "./types.js";

export type DoNotCrawlSeedFile = {
  repos: DoNotCrawlRule[];
  owners: DoNotCrawlRule[];
};

export type RemoveRepoState = {
  repoIndex: ShadowRepoIndex;
  repoOverlay: ShadowRepoOverlay;
  skillOverlay: ShadowSkillOverlay;
  cutoverSkills: ShadowSkillRecord[];
  shadowSkills: ShadowSkillRecord[];
  signals: ShadowCutoverSkillSignal[];
};

export type RemoveRepoResult = RemoveRepoState & {
  repo: string;
  removedSkills: ShadowSkillRecord[];
};

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  if (path.startsWith(shadowRoot)) assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function emptyRepoIndex(generatedAt: string): ShadowRepoIndex {
  return { generatedAt, repoCount: 0, repos: [] };
}

function emptySkillOverlay(generatedAt: string): ShadowSkillOverlay {
  return { generatedAt, skillCount: 0, skills: [] };
}

function skillMatchesRepo(skill: Pick<ShadowSkillRecord, "id">, repo: string): boolean {
  return repoFromSkillId(skill.id) === repo;
}

function removeRepoFromIndex<T extends ShadowRepoIndex | ShadowRepoOverlay>(index: T, repo: string): T {
  const repos = index.repos.filter((entry) => entry.repo !== repo);
  return { ...index, repoCount: repos.length, repos };
}

export function upsertDoNotCrawlRepo(
  seedFile: DoNotCrawlSeedFile,
  repoInput: string,
  reason: DoNotCrawlReason = "catalog",
  notes?: string,
): DoNotCrawlSeedFile {
  const repo = normalizeRepoKey(repoInput);
  const byRepo = new Map((seedFile.repos ?? []).map((rule) => [normalizeRepoKey(rule.repo ?? ""), rule]));
  byRepo.set(repo, {
    ...byRepo.get(repo),
    repo,
    reason,
    ...(notes ? { notes } : {}),
  });
  return {
    repos: [...byRepo.values()].sort((a, b) => (a.repo ?? "").localeCompare(b.repo ?? "")),
    owners: [...(seedFile.owners ?? [])],
  };
}

export function removeRepoFromShadowState(state: RemoveRepoState, repoInput: string): RemoveRepoResult {
  const repo = normalizeRepoKey(repoInput);
  const removedById = new Map<string, ShadowSkillRecord>();

  for (const skill of [...state.cutoverSkills, ...state.skillOverlay.skills, ...state.shadowSkills]) {
    if (skillMatchesRepo(skill, repo)) removedById.set(skill.id, skill);
  }

  const removedIds = new Set(removedById.keys());
  const skillOverlaySkills = state.skillOverlay.skills.filter((skill) => !removedIds.has(skill.id));

  return {
    repo,
    removedSkills: [...removedById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    repoIndex: removeRepoFromIndex(state.repoIndex, repo),
    repoOverlay: removeRepoFromIndex(state.repoOverlay, repo),
    skillOverlay: {
      ...state.skillOverlay,
      skillCount: skillOverlaySkills.length,
      skills: skillOverlaySkills,
    },
    cutoverSkills: state.cutoverSkills.filter((skill) => !removedIds.has(skill.id)),
    shadowSkills: state.shadowSkills.filter((skill) => !removedIds.has(skill.id)),
    signals: state.signals.filter((signal) => !removedIds.has(signal.id)),
  };
}

async function main() {
  loadTrustedSeeds("manual-command");
  const repoArg = process.argv[2];
  if (!repoArg) {
    throw new Error("Usage: npm run crawl4:remove-repo -- owner/repo");
  }

  const repo = normalizeRepoKey(repoArg);
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)) {
    throw new Error(`Invalid repo: ${repoArg}`);
  }

  const generatedAt = new Date().toISOString();
  const doNotCrawlPath = join(indexRoot, "seeds", "do-not-crawl.json");
  const repoOverlayPath = join(shadowRoot, "repo-index.overlay.json");
  const repoIndexPath = join(shadowRoot, "repo-index.shadow.json");
  const skillOverlayPath = join(shadowRoot, "skills.overlay.json");
  const cutoverSkillsPath = join(shadowRoot, "skills.cutover.shadow.json");
  const shadowSkillsPath = join(shadowRoot, "skills.shadow.json");
  const signalsPath = join(shadowRoot, "skill-signals.cutover.shadow.json");

  const doNotCrawl = readJson<DoNotCrawlSeedFile>(doNotCrawlPath, { repos: [], owners: [] });
  const repoOverlay = readJson<ShadowRepoOverlay>(repoOverlayPath, emptyRepoIndex(generatedAt));
  const repoIndex = readJson<ShadowRepoIndex>(repoIndexPath, emptyRepoIndex(generatedAt));
  const skillOverlay = readJson<ShadowSkillOverlay>(skillOverlayPath, emptySkillOverlay(generatedAt));
  const cutoverSkills = readJson<ShadowSkillRecord[]>(cutoverSkillsPath, []);
  const shadowSkills = readJson<ShadowSkillRecord[]>(shadowSkillsPath, []);
  const signals = readJson<ShadowCutoverSkillSignal[]>(signalsPath, []);
  const alreadyBlocked = doNotCrawl.repos.some((rule) => normalizeRepoKey(rule.repo ?? "") === repo);

  const nextDoNotCrawl = upsertDoNotCrawlRepo(
    doNotCrawl,
    repo,
    "catalog",
    alreadyBlocked ? undefined : "Manually removed from Crawl 4 maintained output.",
  );
  const nextState = removeRepoFromShadowState(
    { repoIndex, repoOverlay, skillOverlay, cutoverSkills, shadowSkills, signals },
    repo,
  );

  const validationFailures = validateCutoverOutputs(nextState.cutoverSkills, nextState.signals, nextState.repoIndex);
  if (validationFailures.length > 0) {
    throw new Error(`Manual removal would break cutover validation: ${validationFailures[0]?.details}`);
  }

  writeJson(doNotCrawlPath, nextDoNotCrawl);
  writeJson(repoOverlayPath, nextState.repoOverlay);
  writeJson(repoIndexPath, nextState.repoIndex);
  writeJson(skillOverlayPath, nextState.skillOverlay);
  writeJson(cutoverSkillsPath, nextState.cutoverSkills);
  if (existsSync(shadowSkillsPath)) writeJson(shadowSkillsPath, nextState.shadowSkills);
  if (existsSync(signalsPath)) writeJson(signalsPath, nextState.signals);

  console.log(`removed repo: ${repo}`);
  console.log(`removed skills: ${nextState.removedSkills.length}`);
  for (const skill of nextState.removedSkills) {
    console.log(`- ${skill.id} — ${skill.name}`);
  }
  console.log("added to do-not-crawl");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
