import {
  normalizePolicyRepo,
  normalizePolicySkillId,
  policyRepoFromSkillId,
} from "../../../scripts/policy-identifiers.mjs";
import type { TrustedSeeds } from "../new-crawl/types.js";
import type { PolicyReasonCode } from "./types.js";

export type EffectivePolicyDecision = {
  excluded: boolean;
  reasonCode: PolicyReasonCode | null;
  matchedSource: string | null;
  matchedKey: string | null;
};

const ALLOWED: EffectivePolicyDecision = {
  excluded: false,
  reasonCode: null,
  matchedSource: null,
  matchedKey: null,
};

function ownerFromRepo(repo: string): string {
  return repo.split("/")[0] ?? "";
}

export function repoFromGithubUrl(value: string | null | undefined): string {
  const match = (value ?? "").match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return "";
  return normalizePolicyRepo(`${match[1]}/${match[2]!.replace(/\.git$/i, "")}`);
}

export function evaluateEffectiveRepoPolicy(repoInput: string, seeds: TrustedSeeds): EffectivePolicyDecision {
  const repo = normalizePolicyRepo(repoInput);
  const owner = ownerFromRepo(repo);
  if (seeds.doNotCrawlRepos?.has(repo)) {
    return { excluded: true, reasonCode: "do-not-crawl", matchedSource: "doNotCrawl.repos", matchedKey: repo };
  }
  if (seeds.doNotCrawlOwners?.has(owner)) {
    return { excluded: true, reasonCode: "do-not-crawl", matchedSource: "doNotCrawl.owners", matchedKey: owner };
  }
  if (seeds.repoOverrides.some((entry) => entry.repo === repo && entry.exclude === true)) {
    return { excluded: true, reasonCode: "repo-override-exclude", matchedSource: "repoOverrides", matchedKey: repo };
  }
  return ALLOWED;
}

export function evaluateEffectiveSkillPolicy(
  skill: { id: string; github_url?: string },
  seeds: TrustedSeeds,
): EffectivePolicyDecision {
  const id = normalizePolicySkillId(skill.id);
  const idRepo = policyRepoFromSkillId(id);
  const idRepoDecision = evaluateEffectiveRepoPolicy(idRepo, seeds);
  if (idRepoDecision.excluded) return idRepoDecision;

  const publisherRepo = repoFromGithubUrl(skill.github_url);
  if (publisherRepo && publisherRepo !== idRepo) {
    const publisherDecision = evaluateEffectiveRepoPolicy(publisherRepo, seeds);
    if (publisherDecision.excluded) return publisherDecision;
  }

  if (seeds.suppressedSkillIds?.has(id)) {
    return { excluded: true, reasonCode: "suppressed-skill", matchedSource: "suppressedSkills", matchedKey: id };
  }
  return ALLOWED;
}
