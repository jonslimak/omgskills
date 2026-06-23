import {
  buildDailyPriorityRepos,
  buildNextPromotionCandidates,
  buildNextPromotionShortlist,
  type DailyPriorityDiscoveredRepo,
} from "./daily-priority.js";
import { classifyDerivedRepoTier } from "./tiering.js";
import type { MomentumSource } from "./momentum.js";
import type { Crawl4Preview, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillRecord, TrustedSeeds } from "./types.js";

type BuildCrawl4PreviewOptions = {
  repoIndex: ShadowRepoIndex;
  shadowSkills: ShadowSkillRecord[];
  unresolvedCatalogPublishers: Array<{ publisherRepo: string; count: number }>;
  discovered: Map<string, DailyPriorityDiscoveredRepo>;
  momentumByRepo: Map<string, Set<MomentumSource>>;
  seeds: TrustedSeeds;
};

function sortStrings(values: Iterable<string>, limit?: number): string[] {
  const rows = [...new Set(values)].sort();
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
}

function sampleRepos(repos: ShadowRepoIndexEntry[]): string[] {
  return repos.map((repo) => repo.repo);
}

function buildTierCounts(shadowSkills: ShadowSkillRecord[], seeds: TrustedSeeds): Crawl4Preview["tierCounts"] {
  const byRepo = new Map<string, number>();
  for (const skill of shadowSkills) {
    const upstreamRepo = skill.upstream_repo ?? repoFromGithubUrl(skill.github_url);
    if (!upstreamRepo) continue;
    byRepo.set(upstreamRepo, Math.max(byRepo.get(upstreamRepo) ?? 0, skill.stars));
  }

  const counts: Crawl4Preview["tierCounts"] = { tier1: 0, tier2: 0, longtail: 0 };
  for (const [upstreamRepo, stars] of byRepo) {
    counts[classifyDerivedRepoTier({ upstreamRepo, stars, seeds })] += 1;
  }
  return counts;
}

function repoFromGithubUrl(githubUrl: string): string | null {
  try {
    const url = new URL(githubUrl);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

function buildRepresentedRepos(
  repoIndex: ShadowRepoIndex,
  shadowSkills: ShadowSkillRecord[],
  discovered: Map<string, DailyPriorityDiscoveredRepo>,
): Set<string> {
  const represented = new Set<string>();
  for (const repo of repoIndex.repos) represented.add(repo.repo);
  for (const repo of discovered.keys()) represented.add(repo);
  for (const skill of shadowSkills) {
    const upstreamRepo = skill.upstream_repo ?? repoFromGithubUrl(skill.github_url);
    if (upstreamRepo) represented.add(upstreamRepo);
  }
  return represented;
}

function buildMomentumCounts(momentumByRepo: Map<string, Set<MomentumSource>>): Crawl4Preview["momentumCounts"] {
  const counts = { skillssh: 0, validatedX: 0, both: 0 };
  for (const sources of momentumByRepo.values()) {
    const hasSkillsSh = sources.has("skillssh");
    const hasValidatedX = sources.has("validatedX");
    if (hasSkillsSh && hasValidatedX) counts.both += 1;
    else if (hasSkillsSh) counts.skillssh += 1;
    else if (hasValidatedX) counts.validatedX += 1;
  }
  return counts;
}

type PreviewShortlistReason = "official" | "momentum" | "trustedVendor" | "goldBasket" | "periodic" | "background";

type PreviewShortlistCandidate = {
  repo: string;
  stars: number;
  reason: PreviewShortlistReason;
};

const PREVIEW_SHORTLIST_LIMIT = 20;
const PREVIEW_DAILY_PRIORITY_REPO_LIMIT = 50;
const PREVIEW_SHORTLIST_BUCKET_CAPS: Array<{ reason: PreviewShortlistReason; cap: number }> = [
  { reason: "official", cap: 4 },
  { reason: "momentum", cap: 6 },
  { reason: "trustedVendor", cap: 3 },
  { reason: "goldBasket", cap: 2 },
  { reason: "periodic", cap: 3 },
  { reason: "background", cap: 2 },
];

function previewShortlistReasonRank(reason: PreviewShortlistReason): number {
  switch (reason) {
    case "official":
      return 0;
    case "momentum":
      return 1;
    case "trustedVendor":
      return 2;
    case "goldBasket":
      return 3;
    case "periodic":
      return 4;
    case "background":
      return 5;
  }
}

function previewShortlistReasonForRepo(
  repo: ShadowRepoIndexEntry | null,
  discoveredRepo: DailyPriorityDiscoveredRepo,
  momentumByRepo: Map<string, Set<MomentumSource>>,
  seeds: TrustedSeeds,
): PreviewShortlistReason {
  if (seeds.officialTier1Repos.has(discoveredRepo.repo) || seeds.officialTier2Repos.has(discoveredRepo.repo)) {
    return "official";
  }
  if (momentumByRepo.has(discoveredRepo.repo)) return "momentum";
  if (repo?.isTrustedVendor) return "trustedVendor";
  if (repo?.isGoldBasketRepo) return "goldBasket";
  if (discoveredRepo.lanes.has("periodic")) return "periodic";
  return "background";
}

function isPreviewShortlistEligible(candidate: PreviewShortlistCandidate): boolean {
  if (candidate.reason === "official") return true;
  if (candidate.reason === "momentum") return candidate.stars >= 100;
  return candidate.stars >= 250;
}

function buildProposedShortlistRepos(
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DailyPriorityDiscoveredRepo>,
  dailyPriorityRepos: ShadowRepoIndexEntry[],
  momentumByRepo: Map<string, Set<MomentumSource>>,
  seeds: TrustedSeeds,
): string[] {
  const dailyPrioritySet = new Set(dailyPriorityRepos.map((repo) => repo.repo));
  const catalogRepoSet = new Set(seeds.catalogRepoRules.map((rule) => rule.repo));
  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));

  const candidates = [...discovered.values()]
    .filter((repo) => !dailyPrioritySet.has(repo.repo))
    .filter((repo) => !catalogRepoSet.has(repo.repo))
    .filter((repo) => {
      const existing = repoByName.get(repo.repo);
      return !existing || existing.state === "library";
    })
    .map((discoveredRepo) => {
      const repo = repoByName.get(discoveredRepo.repo) ?? null;
      return {
        repo: discoveredRepo.repo,
        stars: repo?.stars ?? discoveredRepo.stars,
        reason: previewShortlistReasonForRepo(repo, discoveredRepo, momentumByRepo, seeds),
      } satisfies PreviewShortlistCandidate;
    })
    .filter(isPreviewShortlistEligible)
    .sort((a, b) => {
      const reasonDelta = previewShortlistReasonRank(a.reason) - previewShortlistReasonRank(b.reason);
      if (reasonDelta !== 0) return reasonDelta;
      return b.stars - a.stars || a.repo.localeCompare(b.repo);
    });

  const shortlist: PreviewShortlistCandidate[] = [];
  const byReason = new Map<PreviewShortlistReason, PreviewShortlistCandidate[]>();
  for (const candidate of candidates) {
    const rows = byReason.get(candidate.reason) ?? [];
    rows.push(candidate);
    byReason.set(candidate.reason, rows);
  }

  for (const bucket of PREVIEW_SHORTLIST_BUCKET_CAPS) {
    const rows = byReason.get(bucket.reason) ?? [];
    for (const candidate of rows.slice(0, bucket.cap)) {
      if (shortlist.length >= PREVIEW_SHORTLIST_LIMIT) break;
      shortlist.push(candidate);
    }
    if (shortlist.length >= PREVIEW_SHORTLIST_LIMIT) break;
  }

  return shortlist.map((row) => row.repo);
}

function buildProposedDailyPriorityRepos(
  repoIndex: ShadowRepoIndex,
  momentumByRepo: Map<string, Set<MomentumSource>>,
  seeds: TrustedSeeds,
): Array<{ repo: string; score: number; reasons: string[] }> {
  return repoIndex.repos
    .filter((repo) => repo.state === "core" || repo.state === "rising")
    .map((repo) => scoreDailyPriorityRepo(repo, momentumByRepo, seeds))
    .sort((a, b) => b.score - a.score || b.stars - a.stars || a.repo.localeCompare(b.repo))
    .slice(0, PREVIEW_DAILY_PRIORITY_REPO_LIMIT)
    .map(({ stars: _stars, ...row }) => row);
}

function scoreDailyPriorityRepo(
  repo: ShadowRepoIndexEntry,
  momentumByRepo: Map<string, Set<MomentumSource>>,
  seeds: TrustedSeeds,
): { repo: string; stars: number; score: number; reasons: string[] } {
  const parts: Array<{ reason: string; points: number }> = [];
  const add = (reason: string, points: number) => parts.push({ reason, points });

  if (seeds.officialTier1Repos.has(repo.repo)) add("official-tier1", 32);
  else if (seeds.officialTier2Repos.has(repo.repo)) add("official-tier2", 20);

  if (repo.isGoldBasketRepo) add("gold-basket", 20);
  if (repo.isTrustedVendor) add("trusted-vendor", 20);

  const tier = classifyDerivedRepoTier({ upstreamRepo: repo.repo, stars: repo.stars, seeds });
  if (tier === "tier1") add("derived-tier1", 12);
  else if (tier === "tier2") add("derived-tier2", 4);

  const isRelevant = hasRelevantRepoSignal(repo);
  const isCleanMultiSkill = repo.skillCount >= 2 && !repo.staleOrInvalidState;
  if (momentumByRepo.has(repo.repo)) add("momentum", 10);
  if (isRelevant) add("relevant-skill-repo", 12);
  if (isCleanMultiSkill) add("multi-skill-clean", 4);
  if (repo.stars >= 50_000 && isRelevant && isCleanMultiSkill) add("high-value-clean-relevant", 24);

  if (repo.stars >= 50_000) add("stars>=50000", 14);
  else if (repo.stars >= 10_000) add("stars>=10000", 8);
  else if (repo.stars >= 1_000) add("stars>=1000", 2);

  return {
    repo: repo.repo,
    stars: repo.stars,
    score: parts.reduce((sum, part) => sum + part.points, 0),
    reasons: parts.map((part) => `${part.reason}+${part.points}`),
  };
}

function hasRelevantRepoSignal(repo: ShadowRepoIndexEntry): boolean {
  const haystack = [
    repo.repo,
    repo.topSkillId ?? "",
    ...repo.skillIds.slice(0, 20),
  ].join(" ").toLowerCase();
  return [
    "ai",
    "agent",
    "browser",
    "playwright",
    "testing",
    "test",
    "automation",
    "claude",
    "codex",
    "skill",
    "mcp",
    "tool",
  ].some((keyword) => haystack.includes(keyword));
}

export function buildCrawl4Preview({
  repoIndex,
  shadowSkills,
  unresolvedCatalogPublishers,
  discovered,
  momentumByRepo,
  seeds,
}: BuildCrawl4PreviewOptions): Crawl4Preview {
  const representedRepos = buildRepresentedRepos(repoIndex, shadowSkills, discovered);
  const currentSelection = buildDailyPriorityRepos(repoIndex, discovered);
  const currentDailyPriorityRepos = sampleRepos(currentSelection.repos);
  const proposedDailyPriorityScoreRows = buildProposedDailyPriorityRepos(repoIndex, momentumByRepo, seeds);
  const proposedDailyPriorityRepos = proposedDailyPriorityScoreRows.map((row) => row.repo);
  const currentShortlistRepos = buildNextPromotionShortlist(
    buildNextPromotionCandidates(
      repoIndex,
      discovered,
      currentSelection.repos,
      new Set(seeds.catalogRepoRules.map((rule) => rule.repo)),
    ),
  ).map((row) => row.repo);
  const proposedShortlistRepos = buildProposedShortlistRepos(
    repoIndex,
    discovered,
    currentSelection.repos,
    momentumByRepo,
    seeds,
  );

  return {
    tierCounts: buildTierCounts(shadowSkills, seeds),
    missingTier1Repos: sortStrings(
      [...seeds.officialTier1Repos].filter((repo) => !representedRepos.has(repo)),
      10,
    ),
    missingTier2Repos: sortStrings(
      [...seeds.officialTier2Repos].filter((repo) => !representedRepos.has(repo)),
      10,
    ),
    unresolvedCatalogRepos: sortStrings(
      unresolvedCatalogPublishers.map((row) => row.publisherRepo),
      10,
    ),
    momentumCounts: buildMomentumCounts(momentumByRepo),
    momentumRepoSample: sortStrings(momentumByRepo.keys(), 10),
    currentDailyPriorityRepos,
    proposedDailyPriorityRepos,
    proposedDailyPriorityScoreSample: proposedDailyPriorityScoreRows.slice(0, 10),
    dailyPriorityAdded: sortStrings(
      proposedDailyPriorityRepos.filter((repo) => !currentDailyPriorityRepos.includes(repo)),
      10,
    ),
    dailyPriorityRemoved: sortStrings(
      currentDailyPriorityRepos.filter((repo) => !proposedDailyPriorityRepos.includes(repo)),
      10,
    ),
    currentShortlistRepos,
    proposedShortlistRepos,
    shortlistAdded: sortStrings(
      proposedShortlistRepos.filter((repo) => !currentShortlistRepos.includes(repo)),
      10,
    ),
    shortlistRemoved: sortStrings(
      currentShortlistRepos.filter((repo) => !proposedShortlistRepos.includes(repo)),
      10,
    ),
  };
}
