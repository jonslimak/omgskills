import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CategoryId = "influential" | "most-used" | "peak" | "consistent" | "prolific" | "efficient";

interface AuthorLeaderboardRecord {
  authorHandle: string;
  isVendor: boolean;
  stats: {
    skillCount: number;
    totalStars: number;
    totalInstalls: number;
  };
  leaderboardCategories: Partial<Record<CategoryId, { rank: number; value: string; detail: string }>>;
}

interface TrendingLeaderboardRecord {
  rank: number;
  id: string;
  name: string;
  authorHandle: string;
  stars: number;
  installs: number;
  githubUrl: string;
}

const CATEGORIES: Array<{ id: CategoryId; icon: string; title: string; subtitle: string; insight: string; color: {
  bg: string;
  accent: string;
  border: string;
  medal: string;
} }> = [
  {
    id: "influential",
    icon: "🏆",
    title: "Most Influential",
    subtitle: "Total stars across all skills",
    insight: "Total stars measure ecosystem reputation: how much the community values an author's body of work.",
    color: { bg: "#fffbeb", accent: "#d97706", border: "#fde68a", medal: "#f59e0b" },
  },
  {
    id: "most-used",
    icon: "⚡",
    title: "Most Used",
    subtitle: "Total installs across all skills",
    insight: "Installs measure real-world utility: developers voting with their workflows, not their stars.",
    color: { bg: "#fff7ed", accent: "#ea580c", border: "#fed7aa", medal: "#f97316" },
  },
  {
    id: "peak",
    icon: "💎",
    title: "Peak Achiever",
    subtitle: "Highest single-skill star count",
    insight: "One breakout skill can define a creator's legacy. This measures the single best release.",
    color: { bg: "#f0fdf4", accent: "#16a34a", border: "#bbf7d0", medal: "#22c55e" },
  },
  {
    id: "consistent",
    icon: "🎯",
    title: "Most Consistent",
    subtitle: "Highest avg stars per skill",
    insight: "Average quality is hard to sustain. These creators ship hits, not just volume.",
    color: { bg: "#eff6ff", accent: "#2563eb", border: "#bfdbfe", medal: "#3b82f6" },
  },
  {
    id: "prolific",
    icon: "📚",
    title: "Most Prolific",
    subtitle: "Most skills published with a quality floor",
    insight: "Volume with quality is rare. These creators ship constantly without losing community trust.",
    color: { bg: "#fdf4ff", accent: "#9333ea", border: "#e9d5ff", medal: "#a855f7" },
  },
  {
    id: "efficient",
    icon: "🚀",
    title: "Install Efficiency",
    subtitle: "Avg installs per skill",
    insight: "Efficiency reveals which creators nail real developer needs every time they ship.",
    color: { bg: "#f0fdfa", accent: "#0d9488", border: "#99f6e4", medal: "#14b8a6" },
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const trendingPath = join(root, "trending-leaderboard.json");
const authorsPath = join(root, "author-leaderboards.json");
const outPath = join(root, "leaderboard-view-data.json");

function writeAtomicJson(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tempPath, path);
}

function generatedAt(): string {
  const mtime = Math.max(statSync(trendingPath).mtimeMs, statSync(authorsPath).mtimeMs);
  return new Date(mtime).toISOString();
}

function categoryRows(records: AuthorLeaderboardRecord[], categoryId: CategoryId) {
  return records
    .filter((record) => record.leaderboardCategories?.[categoryId])
    .sort((a, b) => a.leaderboardCategories[categoryId]!.rank - b.leaderboardCategories[categoryId]!.rank)
    .slice(0, 20)
    .map((record, index) => {
      const categoryData = record.leaderboardCategories[categoryId]!;
      return {
        authorHandle: record.authorHandle,
        isVendor: record.isVendor,
        value: ["most-used", "efficient"].includes(categoryId) && index > 0
          ? categoryData.value.replace(/ installs(?:\/skill)?$/, "")
          : categoryData.value,
        detail: record.leaderboardCategories[categoryId]!.detail,
      };
    });
}

function goatTrophies(record: AuthorLeaderboardRecord) {
  return CATEGORIES
    .filter((category) => record.leaderboardCategories?.[category.id])
    .map((category) => `${category.icon} ${category.title}`);
}

function main() {
  const trending = JSON.parse(readFileSync(trendingPath, "utf8")) as TrendingLeaderboardRecord[];
  const authors = JSON.parse(readFileSync(authorsPath, "utf8")) as AuthorLeaderboardRecord[];

  const viewData = {
    version: 1,
    generatedAt: generatedAt(),
    topSkills: trending.slice(0, 10),
    creatorCategories: CATEGORIES.map((category) => ({
      ...category,
      rows: categoryRows(authors, category.id),
    })),
    allRounders: authors
      .filter((record) => goatTrophies(record).length > 0)
      .sort((a, b) => goatTrophies(b).length - goatTrophies(a).length || b.stats.totalStars - a.stats.totalStars || a.authorHandle.localeCompare(b.authorHandle))
      .map((record) => ({
        authorHandle: record.authorHandle,
        isVendor: record.isVendor,
        skillCount: record.stats.skillCount,
        totalStars: record.stats.totalStars,
        totalInstalls: record.stats.totalInstalls,
        trophies: goatTrophies(record),
      })),
  };

  writeAtomicJson(outPath, viewData);
  console.log(`✓ Wrote leaderboard view data to ${outPath}`);
}

main();
