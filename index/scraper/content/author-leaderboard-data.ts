import type { Skill } from "../types.js";
import { TRUSTED_VENDOR_SET } from "./vendors.js";

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
  totalInstalls: number;
  skillsWithInstalls: number;
  avgInstallsPerSkill: number;
  goldBasketCount: number;
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

export function buildVendorSet(basket: BasketSkillLike[] = []): Set<string> {
  return new Set([
    ...TRUSTED_VENDOR_SET,
    ...basket.filter((skill) => skill.official_vendor).map((skill) => skill.author_handle),
  ]);
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
    basketCounts.set(skill.author_handle, (basketCounts.get(skill.author_handle) ?? 0) + 1);
  }

  const authorData = new Map<string, { skills: Skill[]; installs: number }>();

  for (const skill of skills) {
    if (BOT_ACCOUNTS.has(skill.author_handle)) continue;
    if (!authorData.has(skill.author_handle)) {
      authorData.set(skill.author_handle, { skills: [], installs: 0 });
    }
    const data = authorData.get(skill.author_handle)!;
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

    authors.push({
      handle,
      skillCount: authorSkills.length,
      totalStars,
      avgStars,
      bestSkill: { id: bestSkill.id, name: bestSkill.name, stars: bestSkill.stars },
      totalInstalls: data.installs,
      skillsWithInstalls,
      avgInstallsPerSkill,
      goldBasketCount: basketCounts.get(handle) ?? 0,
      isVendor: vendorSet.has(handle),
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
        .filter((author) => author.skillCount >= 3)
        .sort((a, b) => b.totalStars - a.totalStars),
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
