import type { Skill } from "../types.js";
import {
  loadCreatorRegistry,
  normalizeCreatorHandle,
  vendorHandleVariants,
  type CreatorRegistry,
} from "../creator-registry.js";

export interface BasketSkillLike {
  author_handle: string;
  official_vendor?: boolean;
}

export interface AuthorProfile {
  handle: string;
  skillCount: number;
  totalStars: number;
  avgStars: number;
  bestSkill: { id: string; name: string; stars: number };
  distinctRepoCount: number;
  medianRepoStars: number;
  bestRepoStars: number;
  totalInstalls: number;
  skillsWithInstalls: number;
  avgInstallsPerSkill: number;
  goldBasketCount: number;
  editorialScore: number;
  editorialScoreReasons: string[];
  isVendor: boolean;
}

export interface LeaderboardCategory {
  id: "influential" | "most-used" | "peak" | "consistent" | "prolific" | "efficient";
  title: string;
  ranked: AuthorProfile[];
}

const BOT_ACCOUNTS = new Set([
  "clawdbot", "sickn33", "majiayu000", "aiskillstore",
  "boisenoise", "diegosouzapw",
]);

export function buildVendorSet(
  basket: BasketSkillLike[] = [],
  registry: CreatorRegistry = loadCreatorRegistry(),
): Set<string> {
  return new Set([
    ...vendorHandleVariants(registry),
    ...basket
      .filter((skill) => skill.official_vendor && skill.author_handle.trim())
      .map((skill) => normalizeCreatorHandle(skill.author_handle)),
  ]);
}

function repoFromSkill(skill: Skill): string {
  const fromId = skill.id.split(":")[0];
  if (fromId.includes("/")) return fromId.toLowerCase();
  try {
    const url = new URL(skill.github_url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`.toLowerCase();
  } catch {
    // fall through
  }
  return fromId.toLowerCase();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function dedupeForEditorialScore(skills: Skill[]): Skill[] {
  const byKey = new Map<string, Skill>();
  for (const skill of skills) {
    const key = skill.skill_md_sha ? `sha:${skill.skill_md_sha}` : `id:${skill.id}`;
    const existing = byKey.get(key);
    if (!existing || skill.stars > existing.stars || (skill.stars === existing.stars && skill.id.localeCompare(existing.id) < 0)) {
      byKey.set(key, skill);
    }
  }
  return [...byKey.values()];
}

function editorialScore(input: {
  goldBasketCount: number;
  totalInstalls: number;
  distinctRepoCount: number;
  medianRepoStars: number;
  bestRepoStars: number;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (input.goldBasketCount > 0) {
    const points = 80 + input.goldBasketCount * 12;
    score += points;
    reasons.push(`${input.goldBasketCount} gold-basket skill${input.goldBasketCount === 1 ? "" : "s"}`);
  }
  if (input.totalInstalls >= 100_000) {
    score += 45;
    reasons.push("100k+ installs");
  } else if (input.totalInstalls >= 10_000) {
    score += 30;
    reasons.push("10k+ installs");
  } else if (input.totalInstalls >= 1_000) {
    score += 15;
    reasons.push("1k+ installs");
  }
  if (input.bestRepoStars >= 10_000) {
    score += 25;
    reasons.push("10k+ best repo stars");
  } else if (input.bestRepoStars >= 1_000) {
    score += 15;
    reasons.push("1k+ best repo stars");
  } else if (input.bestRepoStars >= 500) {
    score += 8;
    reasons.push("500+ best repo stars");
  }
  if (input.medianRepoStars >= 1_000) {
    score += 20;
    reasons.push("1k+ median repo stars");
  } else if (input.medianRepoStars >= 100) {
    score += 10;
    reasons.push("100+ median repo stars");
  }
  if (input.distinctRepoCount >= 10) {
    score += 12;
    reasons.push("10+ distinct repos");
  } else if (input.distinctRepoCount >= 3) {
    score += 6;
    reasons.push("3+ distinct repos");
  }

  return { score, reasons };
}

export function buildAuthorProfiles(
  skills: Skill[],
  trending: Array<{ id: string; installs: number }>,
  basket: BasketSkillLike[] = [],
): AuthorProfile[] {
  const trendMap = new Map(trending.map((entry) => [entry.id, entry.installs]));
  const vendorSet = buildVendorSet(basket);
  const basketCounts = new Map<string, number>();

  for (const skill of basket) {
    const authorHandle = skill.author_handle.trim();
    if (!authorHandle) continue;
    basketCounts.set(authorHandle, (basketCounts.get(authorHandle) ?? 0) + 1);
  }

  const authorData = new Map<string, { skills: Skill[]; installs: number }>();

  for (const skill of skills) {
    const authorHandle = skill.author_handle.trim();
    if (!authorHandle) continue;
    if (BOT_ACCOUNTS.has(authorHandle)) continue;
    if (!authorData.has(authorHandle)) {
      authorData.set(authorHandle, { skills: [], installs: 0 });
    }
    const data = authorData.get(authorHandle)!;
    data.skills.push(skill);
    data.installs += trendMap.get(skill.id) ?? 0;
  }

  const authors: AuthorProfile[] = [];
  for (const [handle, data] of authorData) {
    const authorSkills = data.skills;
    if (authorSkills.length < 1) continue;

    const totalStars = authorSkills.reduce((sum, skill) => sum + skill.stars, 0);
    const avgStars = Math.round(totalStars / authorSkills.length);
    const bestSkill = authorSkills.reduce((best, skill) => (skill.stars > best.stars ? skill : best), authorSkills[0]);
    const skillsWithInstalls = authorSkills.filter((skill) => (trendMap.get(skill.id) ?? 0) > 0).length;
    const avgInstallsPerSkill = authorSkills.length > 0 ? Math.round(data.installs / authorSkills.length) : 0;
    const editorialSkills = dedupeForEditorialScore(authorSkills);
    const repoStars = new Map<string, number>();
    for (const skill of editorialSkills) {
      const repo = repoFromSkill(skill);
      repoStars.set(repo, Math.max(repoStars.get(repo) ?? 0, skill.stars));
    }
    const distinctRepoCount = repoStars.size;
    const repoStarValues = [...repoStars.values()];
    const medianRepoStars = median(repoStarValues);
    const bestRepoStars = Math.max(0, ...repoStarValues);
    const goldBasketCount = basketCounts.get(handle) ?? 0;
    const score = editorialScore({
      goldBasketCount,
      totalInstalls: data.installs,
      distinctRepoCount,
      medianRepoStars,
      bestRepoStars,
    });

    authors.push({
      handle,
      skillCount: authorSkills.length,
      totalStars,
      avgStars,
      bestSkill: { id: bestSkill.id, name: bestSkill.name, stars: bestSkill.stars },
      distinctRepoCount,
      medianRepoStars,
      bestRepoStars,
      totalInstalls: data.installs,
      skillsWithInstalls,
      avgInstallsPerSkill,
      goldBasketCount,
      editorialScore: score.score,
      editorialScoreReasons: score.reasons,
      isVendor: vendorSet.has(normalizeCreatorHandle(handle)),
    });
  }

  return authors;
}

export function buildLeaderboardCategories(authors: AuthorProfile[]): LeaderboardCategory[] {
  return [
    {
      id: "influential",
      title: "Most Influential",
      ranked: authors
        .filter((author) => author.editorialScore > 0)
        .sort((a, b) => b.editorialScore - a.editorialScore || b.goldBasketCount - a.goldBasketCount || b.totalInstalls - a.totalInstalls),
    },
    {
      id: "most-used",
      title: "Most Used",
      ranked: authors
        .filter((author) => author.totalInstalls > 0)
        .sort((a, b) => b.totalInstalls - a.totalInstalls),
    },
    {
      id: "peak",
      title: "Peak Achiever",
      ranked: authors
        .filter((author) => author.skillCount >= 2 && author.bestSkill.stars > 0)
        .sort((a, b) => b.bestSkill.stars - a.bestSkill.stars),
    },
    {
      id: "consistent",
      title: "Most Consistent",
      ranked: authors
        .filter((author) => author.skillCount >= 5)
        .sort((a, b) => b.avgStars - a.avgStars),
    },
    {
      id: "prolific",
      title: "Most Prolific",
      ranked: authors
        .filter((author) => author.avgStars >= 500)
        .sort((a, b) => b.skillCount - a.skillCount),
    },
    {
      id: "efficient",
      title: "Install Efficiency",
      ranked: authors
        .filter((author) => author.skillsWithInstalls >= 3)
        .sort((a, b) => b.avgInstallsPerSkill - a.avgInstallsPerSkill),
    },
  ];
}

export function buildGoatHandleSet(categories: LeaderboardCategory[]): Set<string> {
  const handleCounts = new Map<string, number>();

  for (const category of categories) {
    for (const author of category.ranked.slice(0, 20)) {
      handleCounts.set(author.handle, (handleCounts.get(author.handle) ?? 0) + 1);
    }
  }

  return new Set(
    [...handleCounts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([handle]) => handle),
  );
}
