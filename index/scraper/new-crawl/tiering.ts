import type { TrustedSeeds } from "./types.js";

export type DerivedRepoTier = "tier1" | "tier2" | "longtail";

type ClassifyDerivedRepoTierInput = {
  upstreamRepo: string | null;
  stars: number;
  seeds: TrustedSeeds;
};

export function classifyDerivedRepoTier({
  upstreamRepo,
  stars,
  seeds,
}: ClassifyDerivedRepoTierInput): DerivedRepoTier {
  if (!upstreamRepo) return "longtail";
  if (seeds.officialTier1Repos.has(upstreamRepo) || stars >= 50_000) return "tier1";
  if (seeds.officialTier2Repos.has(upstreamRepo) || stars >= 10_000) return "tier2";
  return "longtail";
}
