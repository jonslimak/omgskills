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

function isTrustedAuthorHint(handle: string, seeds: TrustedSeeds): boolean {
  return seeds.trustedCreatorHandles.has(handle) || seeds.trustedVendorHandles.has(handle);
}

function parseOpenclawSkillAuthor(skill: Skill): ShadowSkillProvenance | null {
  const publisherRepo = repoKeyForSkill(skill);
  if (publisherRepo !== "openclaw/skills") return null;

  const match = skill.id.match(/^[^:]+:skills\/([^/]+)\//i);
  if (!match) return null;

  const authorHandle = normalizeRepo(match[1] ?? "");
  if (!authorHandle) return null;

  return {
    authorHandle,
    publisherHandle: "openclaw",
    publisherRepo: "openclaw/skills",
    upstreamRepo: null,
    provenanceType: "repackaged",
    authorConfidence: "high",
  };
}

function parseAiskillstoreMarketplaceAuthor(skill: Skill, seeds: TrustedSeeds): ShadowSkillProvenance | null {
  const publisherRepo = repoKeyForSkill(skill);
  if (publisherRepo !== "aiskillstore/marketplace") return null;

  const match = skill.id.match(/^[^:]+:skills\/([^/]+)\//i);
  const hintedAuthor = normalizeRepo(match?.[1] ?? "");
  const trustedHint = hintedAuthor && isTrustedAuthorHint(hintedAuthor, seeds) ? hintedAuthor : "";

  return {
    authorHandle: trustedHint,
    publisherHandle: "aiskillstore",
    publisherRepo: "aiskillstore/marketplace",
    upstreamRepo: null,
    provenanceType: "repackaged",
    authorConfidence: trustedHint ? "high" : "low",
  };
}

function parseNeverSightSkillAuthor(skill: Skill): ShadowSkillProvenance | null {
  const publisherRepo = repoKeyForSkill(skill);
  if (publisherRepo !== "neversight/learn-skills.dev") return null;

  const match = skill.id.match(/^[^:]+:data\/skills-md\/([^/]+)\/([^/]+)\//i);
  if (!match) return null;

  const authorHandle = normalizeRepo(match[1] ?? "");
  const upstreamRepoName = normalizeRepo(match[2] ?? "");
  if (!authorHandle || !upstreamRepoName) return null;

  return {
    authorHandle,
    publisherHandle: "neversight",
    publisherRepo: "neversight/learn-skills.dev",
    upstreamRepo: `${authorHandle}/${upstreamRepoName}`,
    provenanceType: "mirrored",
    authorConfidence: "high",
  };
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
  const { repoOverride, idOverride } = overrideForSkill(skill, seeds.provenanceOverrides);
  const parsedOpenclaw = parseOpenclawSkillAuthor(skill);
  const parsedAiskillstore = parseAiskillstoreMarketplaceAuthor(skill, seeds);
  const parsedNeverSight = parseNeverSightSkillAuthor(skill);

  let result: ShadowSkillProvenance;

  if (idOverride) {
    result = applyOverride(
      {
        authorHandle: "",
        publisherHandle,
        publisherRepo,
        upstreamRepo: null,
        provenanceType: "unknown",
        authorConfidence: "low",
      },
      idOverride,
    );
  } else if (parsedNeverSight) {
    result = parsedNeverSight;
  } else if (parsedAiskillstore) {
    result = parsedAiskillstore;
  } else if (parsedOpenclaw) {
    result = parsedOpenclaw;
  } else if (repoOverride) {
    result = applyOverride(
      {
        authorHandle: "",
        publisherHandle,
        publisherRepo,
        upstreamRepo: null,
        provenanceType: "unknown",
        authorConfidence: "low",
      },
      repoOverride,
    );
  } else {
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
  }

  if (!result.authorHandle && result.provenanceType === "original" && result.publisherHandle) {
    result.authorHandle = result.publisherHandle;
  }

  if (!result.authorHandle && result.provenanceType === "unknown") {
    result.authorConfidence = "low";
  }

  return result;
}
