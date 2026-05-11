/**
 * Generates tweet-ready social media content from the gold basket.
 *
 * Usage:
 *   tsx scraper/content/generate-content.ts --format skill-of-the-day
 *   tsx scraper/content/generate-content.ts --format skill-of-the-day --date 2026-05-10
 *   tsx scraper/content/generate-content.ts --format top-3 --niche coding-productivity
 *   tsx scraper/content/generate-content.ts --format trending
 *   tsx scraper/content/generate-content.ts --format author-spotlight --author steipete
 *   tsx scraper/content/generate-content.ts --format stats
 *   tsx scraper/content/generate-content.ts --format all-sotd
 *   tsx scraper/content/generate-content.ts --list-niches
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldSkill } from "./build-gold-basket.js";

const here = dirname(fileURLToPath(import.meta.url));
const basketPath = join(here, "..", "..", "gold-basket.json");
const trendingPath = join(here, "..", "..", "trending.json");
const skillsPath = join(here, "..", "..", "skills.json");

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  author_handle: string;
  tags: string[];
  stars: number;
  github_url: string;
  install_cmd: string;
}

function loadBasket(): GoldSkill[] {
  if (!existsSync(basketPath)) {
    console.error("gold-basket.json not found — run build-gold-basket.ts first");
    process.exit(1);
  }
  return JSON.parse(readFileSync(basketPath, "utf8"));
}

function loadTrending(): TrendingEntry[] {
  if (!existsSync(trendingPath)) return [];
  return JSON.parse(readFileSync(trendingPath, "utf8"));
}

function loadSkills(): Skill[] {
  if (!existsSync(skillsPath)) return [];
  return JSON.parse(readFileSync(skillsPath, "utf8"));
}

function dateSeed(dateStr: string): number {
  const d = new Date(dateStr);
  return Math.floor(d.getTime() / 86_400_000);
}

function pickForDate(basket: GoldSkill[], dateStr: string): GoldSkill {
  const seed = dateSeed(dateStr);
  return basket[seed % basket.length];
}

function fmtInstalls(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// ─── Formats ────────────────────────────────────────────────────────────────

function formatSkillOfTheDay(skill: GoldSkill, date: string): string {
  const statsLine = skill.installs > 0
    ? `⭐ ${fmtStars(skill.stars)} stars  •  📦 ${fmtInstalls(skill.installs)} installs`
    : `⭐ ${fmtStars(skill.stars)} stars`;

  return `🧠 Skill of the Day — ${date}

${skill.name.toUpperCase()}
${truncate(skill.description, 120)}

${statsLine}
👤 by @${skill.author_handle}
🏷 ${skill.niche_label}

📥 Install with one click: omgskills.app

#ClaudeCode #AITools #SkillOfTheDay #${skill.niche_label.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function formatTop3(basket: GoldSkill[], niche: string): string {
  const nicheSkills = basket.filter((s) => s.niche === niche).slice(0, 3);

  if (nicheSkills.length === 0) {
    console.error(`No skills found for niche: ${niche}`);
    process.exit(1);
  }

  const nicheLabel = nicheSkills[0].niche_label;
  const lines = nicheSkills.map((s, i) => {
    const medal = ["1️⃣", "2️⃣", "3️⃣"][i];
    const stats = s.installs > 0
      ? `⭐ ${fmtStars(s.stars)}  📦 ${fmtInstalls(s.installs)}`
      : `⭐ ${fmtStars(s.stars)}`;
    return `${medal} ${s.name}\n   ${truncate(s.description, 90)}\n   ${stats}  •  by @${s.author_handle}`;
  });

  return `🔥 Top 3 ${nicheLabel} Skills right now

${lines.join("\n\n")}

All one-click installable at omgskills.app

#ClaudeCode #AITools #${nicheLabel.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function formatTrending(trending: TrendingEntry[], skills: Skill[]): string {
  const skillMap = new Map(skills.map((s) => [s.id, s]));
  const top5 = trending.slice(0, 5);

  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
  const lines = top5.map((t, i) => {
    const skill = skillMap.get(t.id);
    const name = skill?.name ?? t.id.split(":").pop() ?? t.id;
    return `${medals[i]} ${name} — ${fmtInstalls(t.installs)} installs`;
  });

  const upcomers = trending.slice(5, 8).map((t) => {
    const skill = skillMap.get(t.id);
    return skill?.name ?? t.id.split(":").pop() ?? t.id;
  });

  return `📈 Trending Skills This Week

These are the most-installed skills right now:

${lines.join("\n")}

Up-and-comers: ${upcomers.join(", ")}

See all trending: omgskills.app

#ClaudeCode #AITools #Trending`;
}

function formatAuthorSpotlight(basket: GoldSkill[], skills: Skill[], author: string): string {
  const allAuthorSkills = skills.filter((s) => s.author_handle === author);
  const featuredSkills = basket
    .filter((s) => s.author_handle === author)
    .slice(0, 3);

  if (featuredSkills.length === 0) {
    console.error(`No gold basket skills found for author: ${author}`);
    process.exit(1);
  }

  const lines = featuredSkills.map((s) => `→ ${s.name}: ${truncate(s.description, 80)}`);

  return `🌟 Author Spotlight: @${author}

They've contributed ${allAuthorSkills.length} skills to the omgskills index.
Here are their best:

${lines.join("\n")}

Find all their skills: omgskills.app

#ClaudeCode #AITools #AuthorSpotlight`;
}

function formatStats(basket: GoldSkill[], skills: Skill[], trending: TrendingEntry[]): string {
  const trendingIds = new Set(trending.map((t) => t.id));
  const totalInstalls = trending.reduce((sum, t) => sum + t.installs, 0);
  const avgInstallsTop100 = Math.round(
    trending.slice(0, 100).reduce((sum, t) => sum + t.installs, 0) / Math.min(100, trending.length),
  );
  const avgStarsTop100 = Math.round(
    basket.slice(0, 100).reduce((sum, s) => sum + s.stars, 0) / Math.min(100, basket.length),
  );

  const nicheCounts: Record<string, number> = {};
  for (const s of basket) {
    nicheCounts[s.niche_label] = (nicheCounts[s.niche_label] ?? 0) + 1;
  }
  const topNiche = Object.entries(nicheCounts).sort((a, b) => b[1] - a[1])[0];

  return `📊 omgskills by the Numbers

🗂 ${skills.length.toLocaleString()} skills in the index
📦 ${fmtInstalls(totalInstalls)} total installs tracked
⭐ Avg ${fmtStars(avgStarsTop100)} stars for top-100 skills
📈 Avg ${fmtInstalls(avgInstallsTop100)} installs for top-100 trending
🏆 Most-stacked niche: ${topNiche[0]} (${topNiche[1]} essential skills)

All discoverable at omgskills.app

#ClaudeCode #AITools #DataDriven`;
}

function formatAllSotd(basket: GoldSkill[]): string {
  const today = new Date();
  const lines: string[] = [];
  for (let i = 0; i < basket.length; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    const skill = basket[i];
    lines.push(
      `\n--- ${dateStr} ---\n` + formatSkillOfTheDay(skill, dateStr),
    );
  }
  return lines.join("\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? "true";
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs();

  if ("list-niches" in args) {
    const basket = loadBasket();
    const niches = new Map<string, { label: string; count: number }>();
    for (const s of basket) {
      if (!niches.has(s.niche)) niches.set(s.niche, { label: s.niche_label, count: 0 });
      niches.get(s.niche)!.count++;
    }
    console.log("Available niches:");
    for (const [niche, { label, count }] of niches) {
      console.log(`  ${niche.padEnd(25)} ${label.padEnd(30)} (${count} skills)`);
    }
    return;
  }

  const format = args["format"];
  if (!format) {
    console.error("Usage: tsx scraper/content/generate-content.ts --format <name> [options]");
    console.error("Formats: skill-of-the-day, top-3, trending, author-spotlight, stats, all-sotd");
    process.exit(1);
  }

  const basket = loadBasket();

  switch (format) {
    case "skill-of-the-day": {
      const date = args["date"] ?? new Date().toISOString().slice(0, 10);
      const skill = pickForDate(basket, date);
      console.log(formatSkillOfTheDay(skill, date));
      break;
    }

    case "top-3": {
      const niche = args["niche"];
      if (!niche) {
        console.error("--niche required for top-3 format. Run --list-niches to see options.");
        process.exit(1);
      }
      console.log(formatTop3(basket, niche));
      break;
    }

    case "trending": {
      const trending = loadTrending();
      const skills = loadSkills();
      console.log(formatTrending(trending, skills));
      break;
    }

    case "author-spotlight": {
      const author = args["author"];
      if (!author) {
        console.error("--author required for author-spotlight format");
        process.exit(1);
      }
      const skills = loadSkills();
      console.log(formatAuthorSpotlight(basket, skills, author));
      break;
    }

    case "stats": {
      const trending = loadTrending();
      const skills = loadSkills();
      console.log(formatStats(basket, skills, trending));
      break;
    }

    case "all-sotd": {
      console.log(formatAllSotd(basket));
      break;
    }

    default:
      console.error(`Unknown format: ${format}`);
      console.error("Valid formats: skill-of-the-day, top-3, trending, author-spotlight, stats, all-sotd");
      process.exit(1);
  }
}

main();
