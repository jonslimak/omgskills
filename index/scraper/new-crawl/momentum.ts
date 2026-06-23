import { existsSync, readFileSync } from "node:fs";

export type MomentumSource = "skillssh" | "validatedX";

type DiscoveredRepoLike = {
  repo: string;
  sources: Set<string>;
};

type ValidSkillRepoRow = {
  id?: string;
};

type XArtifactRow = {
  valid_skill_repos?: ValidSkillRepoRow[];
};

export type MomentumBuildResult = {
  momentumByRepo: Map<string, Set<MomentumSource>>;
  warning: string | null;
};

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function addMomentum(
  momentumByRepo: Map<string, Set<MomentumSource>>,
  repo: string,
  source: MomentumSource,
) {
  const normalized = normalizeRepo(repo);
  if (!normalized) return;
  const existing = momentumByRepo.get(normalized);
  if (existing) {
    existing.add(source);
    return;
  }
  momentumByRepo.set(normalized, new Set([source]));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function buildMomentumSignals(
  discovered: Map<string, DiscoveredRepoLike>,
  validatedXPath: string,
): MomentumBuildResult {
  const momentumByRepo = new Map<string, Set<MomentumSource>>();

  for (const repo of discovered.values()) {
    if (repo.sources.has("skillssh")) {
      addMomentum(momentumByRepo, repo.repo, "skillssh");
    }
  }

  if (!existsSync(validatedXPath)) {
    return {
      momentumByRepo,
      warning: "validated X artifact missing",
    };
  }

  const rows = readJson<XArtifactRow[]>(validatedXPath);
  for (const row of rows) {
    for (const repo of row.valid_skill_repos ?? []) {
      if (!repo.id) continue;
      addMomentum(momentumByRepo, repo.id, "validatedX");
    }
  }

  return {
    momentumByRepo,
    warning: null,
  };
}
