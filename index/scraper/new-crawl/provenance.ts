import type { Skill } from "../types.js";
import type {
  CatalogRepoRule,
  ProvenanceOverride,
  ProvenanceType,
  ShadowSkillProvenance,
  TrustedSeeds,
} from "./types.js";

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function repoKeyForSkill(skill: Skill): string {
  try {
    const url = new URL(skill.github_url);
    if (url.hostname !== "github.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

function repoFromId(skillId: string): string {
  const [repo] = skillId.split(":", 1);
  return normalizeRepo(repo ?? "");
}

function ownerHandle(repo: string): string {
  return repo.split("/")[0] ?? "";
}

function overrideForSkill(skill: Skill, overrides: ProvenanceOverride[]) {
  const publisherRepo = repoKeyForSkill(skill);
  const repoOverride = overrides.find((override) => override.repo === publisherRepo);
  const idOverride = overrides.find((override) => override.id === skill.id);
  return { repoOverride, idOverride };
}

function catalogRuleForRepo(repo: string, rules: CatalogRepoRule[]): CatalogRepoRule | undefined {
  return rules.find((rule) => rule.repo === repo);
}

function applyOverride(
  base: ShadowSkillProvenance,
  override: ProvenanceOverride | undefined,
): ShadowSkillProvenance {
  if (!override) return base;
  return {
    authorHandle: override.authorHandle ?? base.authorHandle,
    publisherHandle: override.publisherHandle ?? base.publisherHandle,
    publisherRepo: base.publisherRepo,
    upstreamRepo: override.upstreamRepo ?? base.upstreamRepo,
    provenanceType: override.provenanceType ?? base.provenanceType,
    authorConfidence: override.authorConfidence ?? base.authorConfidence,
  };
}

export function resolveShadowProvenance(skill: Skill, seeds: TrustedSeeds): ShadowSkillProvenance {
  const publisherRepo = repoKeyForSkill(skill);
  const publisherHandle = ownerHandle(publisherRepo);
  const upstreamRepoFromId = repoFromId(skill.id);
  const obviousUpstreamRepo =
    upstreamRepoFromId && publisherRepo && upstreamRepoFromId !== publisherRepo ? upstreamRepoFromId : "";
  const catalogRule = catalogRuleForRepo(publisherRepo, seeds.catalogRepoRules);

  let result: ShadowSkillProvenance;

  if (obviousUpstreamRepo) {
    result = {
      authorHandle: ownerHandle(obviousUpstreamRepo),
      publisherHandle: catalogRule?.publisherHandle ?? publisherHandle,
      publisherRepo,
      upstreamRepo: obviousUpstreamRepo,
      provenanceType: catalogRule?.defaultProvenanceType ?? "repackaged",
      authorConfidence: "high",
    };
  } else if (catalogRule) {
    result = {
      authorHandle: "",
      publisherHandle: catalogRule.publisherHandle ?? publisherHandle,
      publisherRepo,
      upstreamRepo: null,
      provenanceType: catalogRule.defaultProvenanceType ?? "catalog",
      authorConfidence: "low",
    };
  } else if (publisherRepo) {
    result = {
      authorHandle: skill.author_handle || publisherHandle,
      publisherHandle,
      publisherRepo,
      upstreamRepo: null,
      provenanceType: "original",
      authorConfidence: "high",
    };
  } else {
    result = {
      authorHandle: "",
      publisherHandle: "",
      publisherRepo: "",
      upstreamRepo: null,
      provenanceType: "unknown",
      authorConfidence: "low",
    };
  }

  const { repoOverride, idOverride } = overrideForSkill(skill, seeds.provenanceOverrides);
  result = applyOverride(result, repoOverride);
  result = applyOverride(result, idOverride);

  if (!result.authorHandle && result.provenanceType === "original" && result.publisherHandle) {
    result.authorHandle = result.publisherHandle;
  }

  if (!result.authorHandle && result.provenanceType === "unknown") {
    result.authorConfidence = "low";
  }

  return result;
}
