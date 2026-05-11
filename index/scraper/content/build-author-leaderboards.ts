import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import type { GoldSkill } from "./build-gold-basket.js";
import {
  type AuthorProfile,
  buildAuthorProfiles,
  buildGoatHandleSet,
  buildLeaderboardCategories,
} from "./author-leaderboard-data.js";

type CategoryId = "influential" | "most-used" | "peak" | "consistent" | "prolific" | "efficient";

interface AuthorLeaderboardRecord {
  authorHandle: string;
  isVendor: boolean;
  isGoat: boolean;
  stats: {
    skillCount: number;
    totalStars: number;
    avgStars: number;
    bestSkill: { id: string; name: string; stars: number };
    totalInstalls: number;
    skillsWithInstalls: number;
    avgInstallsPerSkill: number;
    goldBasketCount: number;
  };
  leaderboardCategories: Partial<Record<CategoryId, { rank: number; value: string; detail: string }>>;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const skillsPath = join(root, "skills.json");
const trendingPath = join(root, "trending.json");
const basketPath = join(root, "gold-basket.json");
const outPath = join(root, "author-leaderboards.json");

function writeAtomicJson(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tempPath, path);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function categoryDisplay(
  categoryId: CategoryId,
  author: AuthorProfile,
): { value: string; detail: string } {
  switch (categoryId) {
    case "influential":
      return {
        value: `${fmt(author.totalStars)} ⭐`,
        detail: `${author.skillCount} skills · avg ${fmt(author.avgStars)} ⭐`,
      };
    case "most-used":
      return {
        value: `${fmt(author.totalInstalls)} installs`,
        detail: `${author.skillCount} skills · ${author.skillsWithInstalls} with installs`,
      };
    case "peak":
      return {
        value: `${fmt(author.bestSkill.stars)} ⭐`,
        detail: `"${author.bestSkill.name}"`,
      };
    case "consistent":
      return {
        value: `${fmt(author.avgStars)} avg ⭐`,
        detail: `${author.skillCount} skills · ${fmt(author.totalStars)} total ⭐`,
      };
    case "prolific":
      return {
        value: `${author.skillCount} skills`,
        detail: `avg ${fmt(author.avgStars)} ⭐ per skill`,
      };
    case "efficient":
      return {
        value: `${fmt(author.avgInstallsPerSkill)} installs/skill`,
        detail: `${author.skillsWithInstalls} skills with installs`,
      };
  }
}

function main() {
  const skills = JSON.parse(readFileSync(skillsPath, "utf8")) as Skill[];
  const trending = JSON.parse(readFileSync(trendingPath, "utf8")) as Array<{ id: string; installs: number }>;
  const basket = JSON.parse(readFileSync(basketPath, "utf8")) as GoldSkill[];

  const authors = buildAuthorProfiles(skills, trending, basket);
  const categories = buildLeaderboardCategories(authors);
  const goatHandles = buildGoatHandleSet(categories);

  const byHandle = new Map<string, AuthorLeaderboardRecord>();
  for (const author of authors) {
    byHandle.set(author.handle, {
      authorHandle: author.handle,
      isVendor: author.isVendor,
      leaderboardCategories: {},
      isGoat: goatHandles.has(author.handle),
      stats: {
        skillCount: author.skillCount,
        totalStars: author.totalStars,
        avgStars: author.avgStars,
        bestSkill: author.bestSkill,
        totalInstalls: author.totalInstalls,
        skillsWithInstalls: author.skillsWithInstalls,
        avgInstallsPerSkill: author.avgInstallsPerSkill,
        goldBasketCount: author.goldBasketCount,
      },
    });
  }

  for (const category of categories) {
    category.ranked.slice(0, 20).forEach((author, index) => {
      const record = byHandle.get(author.handle);
      if (!record) return;
      record.leaderboardCategories[category.id] = {
        rank: index + 1,
        ...categoryDisplay(category.id, author),
      };
    });
  }

  const output = [...byHandle.values()].sort((a, b) => a.authorHandle.localeCompare(b.authorHandle));
  writeAtomicJson(outPath, output);
  console.log(`Written: ${outPath}`);
  console.log(`  ${output.length} author leaderboard records`);
}

main();
