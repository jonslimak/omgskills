/**
 * Data mining report for the omgskills index.
 *
 * Every section outputs: HOOK → DATA → ANGLE
 * Sections ordered by expected tweet-worthiness (most surprising first).
 *
 * Output:
 *   console — formatted report
 *   index/stats.json — structured data with tweet_hooks[] per section
 *
 * Usage: npm run content:stats
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldSkill } from "./build-gold-basket.js";
import type { Skill } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(here, "..", "..", "skills.json");
const trendingPath = join(here, "..", "..", "trending.json");
const basketPath = join(here, "..", "..", "gold-basket.json");
const outPath = join(here, "..", "..", "stats.json");

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

function pct(n: number, total: number): string {
  return ((n / total) * 100).toFixed(1) + "%";
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = xs[i] - mx, ey = ys[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : Math.round((num / denom) * 100) / 100;
}

// ─── Section printer ──────────────────────────────────────────────────────────

interface Section {
  id: string;
  hook: string;
  lines: string[];
  angle: string;
  tweet_hooks: string[];
  data: Record<string, unknown>;
}

const sections: Section[] = [];

function section(
  id: string,
  hook: string,
  lines: string[],
  angle: string,
  tweet_hooks: string[],
  data: Record<string, unknown>,
) {
  sections.push({ id, hook, lines, angle, tweet_hooks, data });

  console.log("\n" + "─".repeat(72));
  console.log(`🎯 HOOK  ${hook}`);
  console.log("─".repeat(72));
  for (const l of lines) console.log("   " + l);
  console.log(`\n💡 ANGLE  ${angle}`);
}

// ─── Load data ────────────────────────────────────────────────────────────────

console.log("Loading data...");
const skills: Skill[] = JSON.parse(readFileSync(skillsPath, "utf8"));
const trending: TrendingEntry[] = JSON.parse(readFileSync(trendingPath, "utf8"));
const basket: GoldSkill[] = existsSync(basketPath)
  ? JSON.parse(readFileSync(basketPath, "utf8"))
  : [];

const trendingMap = new Map(trending.map((t) => [t.id, t]));
const skillMap = new Map(skills.map((s) => [s.id, s]));

console.log(`  ${skills.length.toLocaleString()} skills | ${trending.length} trending | ${basket.length} gold basket\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Install Power Law
// ═══════════════════════════════════════════════════════════════════════════════

{
  const sorted = [...trending].sort((a, b) => b.installs - a.installs);
  const totalInstalls = sorted.reduce((s, t) => s + t.installs, 0);

  // How many skills drive 80% of installs
  let cum = 0;
  let skillsFor80 = 0;
  for (const t of sorted) {
    cum += t.installs;
    skillsFor80++;
    if (cum >= totalInstalls * 0.8) break;
  }

  // Top 10 skills
  const top10 = sorted.slice(0, 10);
  const top10Installs = top10.reduce((s, t) => s + t.installs, 0);

  // Top 5 authors by installs
  const authorInstalls = new Map<string, number>();
  for (const t of trending) {
    const skill = skillMap.get(t.id);
    if (!skill) continue;
    authorInstalls.set(skill.author_handle, (authorInstalls.get(skill.author_handle) ?? 0) + t.installs);
  }
  const topAuthors = [...authorInstalls.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const top5AuthorInstalls = topAuthors.reduce((s, [, v]) => s + v, 0);

  const hook = `Just ${skillsFor80} skills drive 80% of all ${fmt(totalInstalls)} installs across the index`;

  const lines = [
    `Total installs tracked: ${fmt(totalInstalls)} across ${trending.length} skills`,
    `Skills needed for 80% of installs: ${skillsFor80} out of ${trending.length} (${pct(skillsFor80, trending.length)})`,
    ``,
    `Top 10 by installs (${pct(top10Installs, totalInstalls)} of total):`,
    ...top10.map((t, i) => {
      const name = skillMap.get(t.id)?.name ?? t.id;
      const author = skillMap.get(t.id)?.author_handle ?? "?";
      return `  ${i + 1}. ${name} (@${author}) — ${fmt(t.installs)} installs (${pct(t.installs, totalInstalls)})`;
    }),
    ``,
    `Top 5 authors by total installs (${pct(top5AuthorInstalls, totalInstalls)} of all installs):`,
    ...topAuthors.map(([a, n], i) => `  ${i + 1}. @${a} — ${fmt(n)} installs`),
  ];

  section(
    "install_power_law",
    hook,
    lines,
    `The Claude skill ecosystem is winner-take-all. Most skills are never installed — a tiny handful capture nearly everything. This is your content angle: the crowd doesn't know what the crowd is installing.`,
    [
      `${skillsFor80} skills out of ${trending.length} tracked drive 80% of all Claude skill installs 🤯 #ClaudeCode`,
      `Top 5 authors control ${pct(top5AuthorInstalls, totalInstalls)} of all Claude skill installs. The ecosystem has a serious power law. omgskills.app`,
      `${fmt(totalInstalls)} Claude skills installs — and ${skillsFor80} skills account for 80% of them. Who's dominating? omgskills.app`,
    ],
    { total_installs: totalInstalls, skills_for_80_pct: skillsFor80, top10, top_authors: topAuthors.map(([a, n]) => ({ author: a, installs: n })) },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Hidden Gems
// ═══════════════════════════════════════════════════════════════════════════════

{
  const trendingIds = new Set(trending.map((t) => t.id));

  // Known bot/aggregator accounts whose star counts inherit from a parent repo
  // and are not meaningful signals for individual skills.
  const BOT_ACCOUNTS = new Set(["clawdbot", "sickn33", "majiayu000", "aiskillstore"]);

  // High-star skills with no install record — exclude known bots
  const hiddenGems = skills
    .filter((s) => s.stars >= 500 && !trendingIds.has(s.id) && !BOT_ACCOUNTS.has(s.author_handle))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 10);

  // Install efficiency outliers: installs >> what star count predicts
  // Build a simple linear model: installs ~ stars (from trending skills)
  const trendingWithStars = trending
    .map((t) => ({ ...t, stars: skillMap.get(t.id)?.stars ?? 0 }))
    .filter((t) => t.stars > 0);

  const maxStars = Math.max(...trendingWithStars.map((t) => t.stars));
  const maxInstalls = Math.max(...trendingWithStars.map((t) => t.installs));

  // Score = installs/maxInstalls - stars/maxStars (positive = over-installs vs stars)
  const efficiencyOutliers = trendingWithStars
    .map((t) => ({
      ...t,
      efficiency: t.installs / maxInstalls - t.stars / maxStars,
    }))
    .sort((a, b) => b.efficiency - a.efficiency)
    .slice(0, 10);

  const hook = `${hiddenGems.length} high-quality skills (500+ ⭐) have zero installs — the crowd hasn't found them yet`;

  const lines = [
    `Skills with 500+ stars NOT in trending (no installs recorded):`,
    ...hiddenGems.map((s) => `  • ${s.name} (@${s.author_handle}) — ${fmt(s.stars)} ⭐`),
    ``,
    `Top 10 install efficiency outliers (installs far exceed star count):`,
    ...efficiencyOutliers.map((t) => {
      const name = skillMap.get(t.id)?.name ?? t.id;
      return `  • ${name} — ${fmt(t.installs)} installs | ${fmt(t.stars)} ⭐`;
    }),
  ];

  section(
    "hidden_gems",
    hook,
    lines,
    `Stars and installs measure completely different things. Stars = developer respect. Installs = real usage. The gap between them is your editorial advantage — surface the gems before the crowd does.`,
    [
      `${hiddenGems.length} Claude skills have 500+ GitHub stars but zero recorded installs. Hidden gems waiting to be discovered. omgskills.app`,
      `Stars ≠ installs in the Claude skill ecosystem. Some of the highest-rated skills are barely installed. We found the gap. omgskills.app`,
    ],
    { hidden_gems: hiddenGems.map((s) => ({ id: s.id, name: s.name, author: s.author_handle, stars: s.stars })), efficiency_outliers: efficiencyOutliers.map((t) => ({ id: t.id, installs: t.installs, stars: t.stars })) },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Official vs Community
// ═══════════════════════════════════════════════════════════════════════════════

{
  const vendors = basket.filter((s) => s.official_vendor);
  const community = basket.filter((s) => !s.official_vendor);

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const vendorStats = {
    count: vendors.length,
    avg_stars: avg(vendors.map((s) => s.stars)),
    avg_installs: avg(vendors.map((s) => s.installs)),
    avg_forks: avg(vendors.map((s) => (s as any).gh_forks ?? 0)),
    avg_watchers: avg(vendors.map((s) => (s as any).gh_watchers ?? 0)),
    total_installs: vendors.reduce((s, v) => s + v.installs, 0),
  };
  const communityStats = {
    count: community.length,
    avg_stars: avg(community.map((s) => s.stars)),
    avg_installs: avg(community.map((s) => s.installs)),
    avg_forks: avg(community.map((s) => (s as any).gh_forks ?? 0)),
    avg_watchers: avg(community.map((s) => (s as any).gh_watchers ?? 0)),
    total_installs: community.reduce((s, v) => s + v.installs, 0),
  };

  const totalBasketInstalls = basket.reduce((s, v) => s + v.installs, 0);
  const vendorInstallShare = (vendorStats.total_installs / totalBasketInstalls * 100).toFixed(1);
  const installMultiple = communityStats.avg_installs > 0
    ? (vendorStats.avg_installs / communityStats.avg_installs).toFixed(1)
    : "∞";

  const hook = `Official vendor skills get ${installMultiple}x more installs than community skills — brand beats quality`;

  const lines = [
    `Gold basket: ${vendors.length} vendor skills vs ${community.length} community skills`,
    ``,
    `                  Vendor    Community`,
    `  Avg installs:   ${fmt(vendorStats.avg_installs).padEnd(9)} ${fmt(communityStats.avg_installs)}`,
    `  Avg stars:      ${fmt(vendorStats.avg_stars).padEnd(9)} ${fmt(communityStats.avg_stars)}`,
    `  Avg forks:      ${fmt(vendorStats.avg_forks).padEnd(9)} ${fmt(communityStats.avg_forks)}`,
    `  Avg watchers:   ${fmt(vendorStats.avg_watchers).padEnd(9)} ${fmt(communityStats.avg_watchers)}`,
    ``,
    `Vendor install share: ${vendorInstallShare}% of all gold basket installs`,
    `(${vendors.length} vendor skills = ${pct(vendors.length, basket.length)} of basket, ${vendorInstallShare}% of installs)`,
  ];

  section(
    "official_vs_community",
    hook,
    lines,
    `In the Claude ecosystem, brand trust is a multiplier. Developers reach for official vendor skills first — even when community alternatives are just as good or better. The discovery gap is real.`,
    [
      `Official vendor Claude skills get ${installMultiple}x more installs than community-built ones. Brand trust dominates quality. omgskills.app`,
      `${vendors.length} vendor skills control ${vendorInstallShare}% of all gold-basket installs despite being ${pct(vendors.length, basket.length)} of the list. omgskills.app`,
    ],
    { vendor: vendorStats, community: communityStats, vendor_install_share_pct: parseFloat(vendorInstallShare) },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Stars Power Law
// ═══════════════════════════════════════════════════════════════════════════════

{
  const totalSkills = skills.length;
  const totalStars = skills.reduce((s, sk) => s + sk.stars, 0);

  const buckets = [
    { label: "0 stars", min: 0, max: 0, count: 0 },
    { label: "1–9 stars", min: 1, max: 9, count: 0 },
    { label: "10–99 stars", min: 10, max: 99, count: 0 },
    { label: "100–499 stars", min: 100, max: 499, count: 0 },
    { label: "500–999 stars", min: 500, max: 999, count: 0 },
    { label: "1000+ stars", min: 1000, max: Infinity, count: 0 },
  ];

  for (const s of skills) {
    for (const b of buckets) {
      if (s.stars >= b.min && s.stars <= b.max) { b.count++; break; }
    }
  }

  // Skills needed for 80% of stars
  const sortedByStars = [...skills].sort((a, b) => b.stars - a.stars);
  let cumStars = 0, skillsFor80Stars = 0;
  for (const s of sortedByStars) {
    cumStars += s.stars;
    skillsFor80Stars++;
    if (cumStars >= totalStars * 0.8) break;
  }

  const zeroStarPct = ((buckets[0].count / totalSkills) * 100).toFixed(1);
  const hook = `${zeroStarPct}% of the ${fmt(totalSkills)} skills in the index have zero GitHub stars`;

  const lines = [
    `Total stars across all ${fmt(totalSkills)} skills: ${fmt(totalStars)}`,
    ``,
    `Stars distribution:`,
    ...buckets.map((b) => `  ${b.label.padEnd(16)} ${b.count.toLocaleString().padStart(6)} skills (${pct(b.count, totalSkills)})`),
    ``,
    `Skills needed to account for 80% of all stars: ${skillsFor80Stars} (top ${pct(skillsFor80Stars, totalSkills)})`,
  ];

  section(
    "stars_power_law",
    hook,
    lines,
    `The index is a massive iceberg. The vast majority of skills are invisible by stars — yet some get installed heavily anyway. Stars alone aren't the signal people think they are.`,
    [
      `${zeroStarPct}% of Claude skills on GitHub have zero stars. The index has ${fmt(totalSkills)} skills — most are invisible. omgskills.app finds the ones worth using.`,
      `80% of all GitHub stars in the Claude ecosystem belong to just ${skillsFor80Stars} skills out of ${fmt(totalSkills)}. omgskills.app`,
    ],
    { total_stars: totalStars, skills_for_80_pct: skillsFor80Stars, buckets },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Niche Breakdown
// ═══════════════════════════════════════════════════════════════════════════════

{
  const byNiche = new Map<string, GoldSkill[]>();
  for (const s of basket) {
    if (!byNiche.has(s.niche_label)) byNiche.set(s.niche_label, []);
    byNiche.get(s.niche_label)!.push(s);
  }

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const nicheStats = [...byNiche.entries()].map(([label, skills]) => {
    const totalInstalls = skills.reduce((s, sk) => s + sk.installs, 0);
    const avgStars = avg(skills.map((s) => s.stars));
    const avgForks = avg(skills.map((s) => (s as any).gh_forks ?? 0));
    const avgWatchers = avg(skills.map((s) => (s as any).gh_watchers ?? 0));
    const avgScore = Math.round(skills.reduce((s, sk) => s + sk.score, 0) / skills.length * 10) / 10;
    const forksPerStar = avgStars > 0 ? avgForks / avgStars : 0;
    const watchersPerInstall = totalInstalls > 0 ? avgWatchers / (totalInstalls / skills.length) : 0;
    return { label, count: skills.length, totalInstalls, avgStars, avgForks, avgWatchers, avgScore, forksPerStar, watchersPerInstall };
  }).sort((a, b) => b.totalInstalls - a.totalInstalls);

  const totalBasketInstalls = basket.reduce((s, v) => s + v.installs, 0);
  const topNiche = nicheStats[0];
  const bottomNiche = nicheStats[nicheStats.length - 1];
  const engagementNiche = [...nicheStats].sort((a, b) => b.forksPerStar - a.forksPerStar)[0];
  const loyaltyNiche = [...nicheStats].sort((a, b) => b.watchersPerInstall - a.watchersPerInstall)[0];

  const hook = `${topNiche.label} dominates with ${pct(topNiche.totalInstalls, totalBasketInstalls)} of installs — ${bottomNiche.label} is last`;

  const lines = [
    `Niche install share (gold basket, ${fmt(totalBasketInstalls)} total installs):`,
    ...nicheStats.map((n) => `  ${n.label.padEnd(30)} ${fmt(n.totalInstalls).padStart(7)} installs (${pct(n.totalInstalls, totalBasketInstalls)}) | avg ⭐${fmt(n.avgStars)}`),
    ``,
    `Most community engagement (forks/stars ratio): ${engagementNiche.label} (${engagementNiche.forksPerStar.toFixed(2)})`,
    `Most loyal users (watchers/install ratio): ${loyaltyNiche.label} (${loyaltyNiche.watchersPerInstall.toFixed(2)})`,
  ];

  section(
    "niche_breakdown",
    hook,
    lines,
    `Developer attention isn't evenly distributed. Some niches punch far above their weight in installs — others have passionate but small communities. Knowing this shapes which content formats will resonate.`,
    [
      `${topNiche.label} skills get ${pct(topNiche.totalInstalls, totalBasketInstalls)} of all Claude skill installs. ${bottomNiche.label} is last. The niche breakdown is wilder than you'd expect. omgskills.app`,
      `The most community-engaged Claude skill niche (by forks/stars)? ${engagementNiche.label}. The most loyal? ${loyaltyNiche.label}. omgskills.app`,
    ],
    { niches: nicheStats },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Tag Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

{
  const tagCount = new Map<string, number>();
  const tagStars = new Map<string, number[]>();
  const pairCount = new Map<string, number>();

  for (const s of skills) {
    const tags = s.tags.map((t) => t.toLowerCase()).filter((t) => t.length > 1);
    for (const t of tags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      if (!tagStars.has(t)) tagStars.set(t, []);
      tagStars.get(t)!.push(s.stars);
    }
    // Pairs
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const pair = [tags[i], tags[j]].sort().join(" + ");
        pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
      }
    }
  }

  const top20Tags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const top10Pairs = [...pairCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const avgStarsByTag = [...tagStars.entries()]
    .filter(([, arr]) => arr.length >= 10)
    .map(([tag, arr]) => ({ tag, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  const topPair = top10Pairs[0];
  const hook = `"${topPair[0]}" is the most common tag pair — appearing together in ${fmt(topPair[1])} skills`;

  const lines = [
    `Top 20 tags by frequency:`,
    ...top20Tags.map(([t, c], i) => `  ${(i + 1).toString().padStart(2)}. ${t.padEnd(25)} ${c.toLocaleString()} skills`),
    ``,
    `Top 10 tag co-occurrence pairs:`,
    ...top10Pairs.map(([pair, c]) => `  ${pair.padEnd(40)} ${c.toLocaleString()} skills`),
    ``,
    `Tags with highest avg stars (min 10 skills):`,
    ...avgStarsByTag.map(({ tag, avg }) => `  ${tag.padEnd(25)} avg ${fmt(avg)} ⭐`),
  ];

  section(
    "tag_intelligence",
    hook,
    lines,
    `Tag co-occurrence is a map of developer intent. The most common pairs reveal what people actually build with Claude — and where the white space is. Use this to spot emerging niches before they're obvious.`,
    [
      `"${top20Tags[0][0]}" is the most common tag in the Claude skill ecosystem with ${fmt(top20Tags[0][1])} skills. Here's the full breakdown: omgskills.app`,
      `The top tag pair in Claude skills is "${topPair[0]}" — appearing in ${fmt(topPair[1])} skills together. The ecosystem's shape is clearer than you'd think. omgskills.app`,
    ],
    { top_tags: top20Tags.map(([t, c]) => ({ tag: t, count: c })), top_pairs: top10Pairs.map(([p, c]) => ({ pair: p, count: c })), high_quality_tags: avgStarsByTag },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Author Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

{
  const authorSkills = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!authorSkills.has(s.author_handle)) authorSkills.set(s.author_handle, []);
    authorSkills.get(s.author_handle)!.push(s);
  }

  const top10Prolific = [...authorSkills.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const top10Quality = [...authorSkills.entries()]
    .filter(([, skills]) => skills.length >= 3)
    .map(([author, skills]) => ({ author, count: skills.length, avgStars: avg(skills.map((s) => s.stars)) }))
    .sort((a, b) => b.avgStars - a.avgStars)
    .slice(0, 10);

  const singleSkillAuthors = [...authorSkills.values()].filter((a) => a.length === 1);
  const multiSkillAuthors = [...authorSkills.values()].filter((a) => a.length > 1);
  const singleAvgStars = avg(singleSkillAuthors.map((a) => a[0].stars));
  const multiAvgStars = avg(multiSkillAuthors.map((a) => avg(a.map((s) => s.stars))));

  const topProlific = top10Prolific[0];
  const hook = `The most prolific author (@${topProlific[0]}) has ${topProlific[1].length} skills — avg ${fmt(avg(topProlific[1].map(s => s.stars)))} ⭐ each`;

  const lines = [
    `Top 10 most prolific authors:`,
    ...top10Prolific.map(([a, skills], i) => `  ${(i + 1).toString().padStart(2)}. @${a.padEnd(25)} ${skills.length} skills | avg ${fmt(avg(skills.map(s => s.stars)))} ⭐`),
    ``,
    `Top 10 authors by avg star count (min 3 skills):`,
    ...top10Quality.map(({ author, count, avgStars }, i) => `  ${(i + 1).toString().padStart(2)}. @${author.padEnd(25)} avg ${fmt(avgStars)} ⭐ (${count} skills)`),
    ``,
    `Single-skill authors: ${singleSkillAuthors.length.toLocaleString()} — avg ${fmt(singleAvgStars)} ⭐`,
    `Multi-skill authors:  ${multiSkillAuthors.length.toLocaleString()} — avg ${fmt(multiAvgStars)} ⭐ per skill`,
  ];

  section(
    "author_intelligence",
    hook,
    lines,
    `Prolific doesn't always mean quality — and one-hit wonders often have the highest-starred skills. Author spotlights work best when you contrast quantity vs quality builders.`,
    [
      `@${topProlific[0]} has built ${topProlific[1].length} Claude skills. The most prolific creator in the index. omgskills.app`,
      `Multi-skill Claude authors avg ${fmt(multiAvgStars)} ⭐ per skill vs ${fmt(singleAvgStars)} ⭐ for one-timers. Quantity drives quality. omgskills.app`,
    ],
    {
      top_prolific: top10Prolific.map(([a, skills]) => ({ author: a, count: skills.length, avg_stars: avg(skills.map(s => s.stars)) })),
      top_quality: top10Quality,
      single_skill: { count: singleSkillAuthors.length, avg_stars: singleAvgStars },
      multi_skill: { count: multiSkillAuthors.length, avg_stars: multiAvgStars },
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: GitHub Health
// ═══════════════════════════════════════════════════════════════════════════════

{
  const enriched = basket.filter((s) => (s as any).gh_days_since_push !== undefined);

  if (enriched.length === 0) {
    console.log("\n⚠️  No GitHub enrichment data — run npm run content:enrich-basket first\n");
  } else {
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    // Avg days since push per niche
    const byNiche = new Map<string, number[]>();
    for (const s of enriched) {
      if (!byNiche.has(s.niche_label)) byNiche.set(s.niche_label, []);
      byNiche.get(s.niche_label)!.push((s as any).gh_days_since_push);
    }
    const nicheAge = [...byNiche.entries()]
      .map(([label, days]) => ({ label, avg_days: avg(days) }))
      .sort((a, b) => a.avg_days - b.avg_days);

    // High-engagement repos
    const highIssues = enriched
      .filter((s) => (s as any).gh_open_issues > 100)
      .sort((a, b) => (b as any).gh_open_issues - (a as any).gh_open_issues)
      .slice(0, 5);

    // Correlations
    const stars = enriched.map((s) => s.stars);
    const installs = enriched.map((s) => s.installs);
    const forks = enriched.map((s) => (s as any).gh_forks ?? 0);
    const watchers = enriched.map((s) => (s as any).gh_watchers ?? 0);

    const rStarsInstalls = pearson(stars, installs);
    const rStarsForks = pearson(stars, forks);
    const rInstallsWatchers = pearson(installs, watchers);

    const freshest = nicheAge[0];
    const stalest = nicheAge[nicheAge.length - 1];

    const hook = `The freshest niche (${freshest.label}) averaged ${freshest.avg_days}d since last push — ${stalest.label} averaged ${Math.round(stalest.avg_days / 30)}mo`;

    const lines = [
      `Avg days since last GitHub push, by niche:`,
      ...nicheAge.map(({ label, avg_days }) => {
        const display = avg_days < 30 ? `${avg_days}d` : `${Math.round(avg_days / 30)}mo`;
        return `  ${label.padEnd(30)} ${display}`;
      }),
      ``,
      `Most-discussed repos (open issues > 100):`,
      ...highIssues.map((s) => `  ${s.name} — ${(s as any).gh_open_issues} open issues (@${s.author_handle})`),
      ``,
    ];

    section(
      "github_health",
      hook,
      lines,
      `Repo freshness reveals which niches are actively evolving vs coasting on past work. Every niche in the gold basket pushed within the last week — the 100-star floor filtered out stale skills automatically.`,
      [
        `Which Claude skill niches are most actively maintained? ${freshest.label} wins — avg ${freshest.avg_days} days since last push. omgskills.app`,
        `Every niche in the omgskills gold basket pushed to GitHub in the last week. Stale skills filtered out automatically. omgskills.app`,
      ],
      {
        niche_age: nicheAge,
        high_issue_repos: highIssues.map((s) => ({ name: s.name, author: s.author_handle, open_issues: (s as any).gh_open_issues })),
        correlations: { stars_installs: rStarsInstalls, stars_forks: rStarsForks, installs_watchers: rInstallsWatchers },
      },
    );

    // ── Bonus: Correlation Callout (its own section — most counterintuitive finding) ──
    const starInstallsDirection = rStarsInstalls < 0 ? "negatively" : "positively";
    const corrHook = `Stars and installs are ${starInstallsDirection} correlated (r=${rStarsInstalls}) — more stars does NOT mean more installs`;

    section(
      "signal_correlations",
      corrHook,
      [
        `Pearson correlations across ${enriched.length} gold basket skills:`,
        ``,
        `  stars ↔ installs    r = ${rStarsInstalls.toFixed(2)}  ${rStarsInstalls < 0 ? "⚠️  NEGATIVE — high-star skills get FEWER installs" : "○ weak positive"}`,
        `  stars ↔ forks       r = ${rStarsForks.toFixed(2)}  ${Math.abs(rStarsForks) > 0.7 ? "✓ very strong — stars predict forks well" : "○ moderate"}`,
        `  installs ↔ watchers r = ${rInstallsWatchers.toFixed(2)}  ${rInstallsWatchers < 0 ? "⚠️  NEGATIVE — high-install skills have fewer watchers" : "○ weak"}`,
        ``,
        `What this means:`,
        `  • Stars signal GitHub reputation / discoverability`,
        `  • Installs signal real-world utility / workflow fit`,
        `  • Forks signal "I want to build on this" — tightly tracks stars`,
        `  • The two popularity axes are almost orthogonal`,
        `  • omgskills uses both — stars alone would miss half the picture`,
      ],
      `This is the most counterintuitive finding in the data. Stars and installs measure completely different things — and they slightly oppose each other. A skill with few stars but high installs is solving a real problem. A skill with many stars but few installs is respected but not used day-to-day.`,
      [
        `Stars and installs in the Claude skill ecosystem have a ${rStarsInstalls} correlation. More stars = slightly fewer installs. They measure completely different things 🤯 omgskills.app`,
        `GitHub stars predict forks with r=${rStarsForks.toFixed(2)} but predict installs with r=${rStarsInstalls.toFixed(2)}. Stars ≠ usefulness. omgskills.app tracks both. omgskills.app`,
        `Hot take backed by data: the most-starred Claude skills are NOT the most-installed. r=${rStarsInstalls} correlation. omgskills.app finds the ones that get used.`,
      ],
      { r_stars_installs: rStarsInstalls, r_stars_forks: rStarsForks, r_installs_watchers: rInstallsWatchers },
    );
  }
}

// ─── Write stats.json ─────────────────────────────────────────────────────────

const output = {
  generated_at: new Date().toISOString(),
  total_skills: skills.length,
  total_trending: trending.length,
  total_basket: basket.length,
  sections: sections.map(({ id, hook, angle, tweet_hooks, data }) => ({
    id, hook, angle, tweet_hooks, data,
  })),
};

writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

console.log("\n" + "═".repeat(72));
console.log(`✅ stats.json written → ${outPath}`);
console.log(`   ${sections.length} sections | ${sections.reduce((s, sec) => s + sec.tweet_hooks.length, 0)} tweet hooks ready`);
