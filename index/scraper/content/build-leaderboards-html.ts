/**
 * Generates index/leaderboards.html — a trophy-style creator leaderboard
 * with 6 competitive categories and a GOAT section for all-rounders.
 *
 * Usage: npm run content:leaderboards
 */

import { readFileSync, writeFileSync } from "node:fs";
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

const here = dirname(fileURLToPath(import.meta.url));
const skillsPath  = join(here, "..", "..", "skills.json");
const trendPath   = join(here, "..", "..", "trending.json");
const basketPath  = join(here, "..", "..", "gold-basket.json");
const outPath     = join(here, "..", "..", "leaderboards.html");

// ─── Load ─────────────────────────────────────────────────────────────────────

const skills:  Skill[]      = JSON.parse(readFileSync(skillsPath, "utf8"));
const trending: { id: string; installs: number; trending_rank: number }[] =
  JSON.parse(readFileSync(trendPath, "utf8"));
const basket: GoldSkill[]   = JSON.parse(readFileSync(basketPath, "utf8"));

const authors = buildAuthorProfiles(skills, trending, basket);
const categories = buildLeaderboardCategories(authors);
const categoryMap = new Map(categories.map((category) => [category.id, category]));

// ─── Trophy categories ────────────────────────────────────────────────────────

interface Trophy {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  insight: string;
  tweetHook: string;
  color: { bg: string; accent: string; border: string; medal: string };
  entries: Array<{ handle: string; value: string; detail: string; isVendor: boolean }>;
  winner: (typeof authors)[number];
}

const trophies: Trophy[] = [];

function makeTrophy(
  id: string,
  icon: string,
  title: string,
  subtitle: string,
  insight: string,
  tweetHook: string,
  color: Trophy["color"],
  ranked: AuthorProfile[],
  valueOf: (a: AuthorProfile) => string,
  detailOf: (a: AuthorProfile) => string,
): Trophy {
  // Store 20 so that after filtering out vendors, 10 community entries remain
  const entries = ranked.slice(0, 20).map((a) => ({
    handle: a.handle,
    value: valueOf(a),
    detail: detailOf(a),
    isVendor: a.isVendor,
  }));
  return { id, icon, title, subtitle, insight, tweetHook, color, entries, winner: ranked[0] };
}

// ── 1. Most Influential (total stars, min 3 skills) ──
{
  const ranked = categoryMap.get("influential")!.ranked;
  trophies.push(makeTrophy(
    "influential", "🏆", "Most Influential", "Total stars across all skills",
    "Total stars measure ecosystem reputation — how much the community collectively values an author's body of work.",
    `@${ranked[0].handle} is the most influential Claude skill creator with ${fmt(ranked[0].totalStars)} total ⭐ across ${ranked[0].skillCount} skills. omgskills.app`,
    { bg: "#fffbeb", accent: "#d97706", border: "#fde68a", medal: "#f59e0b" },
    ranked,
    (a) => fmt(a.totalStars) + " ⭐",
    (a) => `${a.skillCount} skills · avg ${fmt(a.avgStars)} ⭐`,
  ));
}

// ── 2. Most Used (total installs, min 1 install) ──
{
  const ranked = categoryMap.get("most-used")!.ranked;
  trophies.push(makeTrophy(
    "most-used", "⚡", "Most Used", "Total installs across all skills",
    "Installs measure real-world utility — developers voting with their workflows, not their stars.",
    `@${ranked[0].handle} is the most-installed Claude skill creator with ${fmt(ranked[0].totalInstalls)} total installs. Stars don't tell this story. omgskills.app`,
    { bg: "#fff7ed", accent: "#ea580c", border: "#fed7aa", medal: "#f97316" },
    ranked,
    (a) => fmt(a.totalInstalls) + " installs",
    (a) => `${a.skillCount} skills · ${a.skillsWithInstalls} with installs`,
  ));
}

// ── 3. Peak Achiever (single highest-starred skill, min 2 skills so not one-trick) ──
{
  const ranked = categoryMap.get("peak")!.ranked;
  trophies.push(makeTrophy(
    "peak", "💎", "Peak Achiever", "Highest single-skill star count",
    "One breakout skill can define a creator's legacy. This measures the single best release — the skill that put them on the map.",
    `@${ranked[0].handle}'s "${ranked[0].bestSkill.name}" has ${fmt(ranked[0].bestSkill.stars)} ⭐ — the highest-starred single Claude skill from any creator. omgskills.app`,
    { bg: "#f0fdf4", accent: "#16a34a", border: "#bbf7d0", medal: "#22c55e" },
    ranked,
    (a) => fmt(a.bestSkill.stars) + " ⭐",
    (a) => `"${a.bestSkill.name}"`,
  ));
}

// ── 4. Most Consistent (avg stars per skill, min 5 skills) ──
{
  const ranked = categoryMap.get("consistent")!.ranked;
  trophies.push(makeTrophy(
    "consistent", "🎯", "Most Consistent", "Highest avg stars per skill (min 5 skills)",
    "Average quality is the hardest thing to sustain. These creators ship hits, not just volume.",
    `@${ranked[0].handle} averages ${fmt(ranked[0].avgStars)} ⭐ per skill across ${ranked[0].skillCount} skills. The most consistent quality creator in the index. omgskills.app`,
    { bg: "#eff6ff", accent: "#2563eb", border: "#bfdbfe", medal: "#3b82f6" },
    ranked,
    (a) => fmt(a.avgStars) + " avg ⭐",
    (a) => `${a.skillCount} skills · ${fmt(a.totalStars)} total ⭐`,
  ));
}

// ── 5. Most Prolific (skill count, quality floor: avgStars >= 500) ──
{
  const ranked = categoryMap.get("prolific")!.ranked;
  trophies.push(makeTrophy(
    "prolific", "📚", "Most Prolific", "Most skills published (avg ≥ 500 ⭐ quality floor)",
    "Volume with quality is rare. These creators ship constantly without compromising on the community's standards.",
    `@${ranked[0].handle} has published ${ranked[0].skillCount} quality Claude skills (avg ${fmt(ranked[0].avgStars)} ⭐ each). The most prolific creator in the index. omgskills.app`,
    { bg: "#fdf4ff", accent: "#9333ea", border: "#e9d5ff", medal: "#a855f7" },
    ranked,
    (a) => a.skillCount + " skills",
    (a) => `avg ${fmt(a.avgStars)} ⭐ per skill`,
  ));
}

// ── 6. Install Efficiency (installs per skill, min 3 skills with installs) ──
{
  const ranked = categoryMap.get("efficient")!.ranked;
  trophies.push(makeTrophy(
    "efficient", "🚀", "Install Efficiency", "Avg installs per skill (min 3 skills with installs)",
    "Efficiency reveals which creators nail real developer needs every time they ship — not just once.",
    `@${ranked[0].handle} averages ${fmt(ranked[0].avgInstallsPerSkill)} installs per Claude skill. The highest hit-rate of any creator. omgskills.app`,
    { bg: "#f0fdfa", accent: "#0d9488", border: "#99f6e4", medal: "#14b8a6" },
    ranked,
    (a) => fmt(a.avgInstallsPerSkill) + " installs/skill",
    (a) => `${a.skillsWithInstalls} skills with installs`,
  ));
}

// ─── GOAT: authors in top 5 of 3+ categories ─────────────────────────────────

const handleTrophyCount = new Map<string, string[]>();
for (const t of trophies) {
  for (const r of t.entries) {
    if (!handleTrophyCount.has(r.handle)) handleTrophyCount.set(r.handle, []);
    handleTrophyCount.get(r.handle)!.push(t.icon + " " + t.title);
  }
}
const goatHandles = buildGoatHandleSet(categories);
const goats = [...handleTrophyCount.entries()]
  .filter(([handle]) => goatHandles.has(handle))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([handle, ts]) => ({
    handle,
    trophies: ts,
    profile: authors.find((a) => a.handle === handle)!,
  }))
  .filter((g) => g.profile);

// ─── Contrast callout ─────────────────────────────────────────────────────────

const starsTop5 = trophies.find((t) => t.id === "influential")!.entries.slice(0,5).map((r) => r.handle);
const installsTop5 = trophies.find((t) => t.id === "most-used")!.entries.slice(0,5).map((r) => r.handle);
const overlap = starsTop5.filter((h) => installsTop5.includes(h));
const onlyStars = starsTop5.filter((h) => !installsTop5.includes(h));
const onlyInstalls = installsTop5.filter((h) => !starsTop5.includes(h));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function medalEmoji(i: number): string {
  return ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"][i] ?? String(i + 1);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderTrophy(t: Trophy, idx: number): string {
  // Rows 11–20 start hidden; JS reveals them when needed to fill top-10 after filtering
  const rows = t.entries.map((r, i) => `
    <div class="lb-row ${i === 0 ? "lb-winner" : ""} ${i >= 10 ? "overflow-hidden" : ""}" data-vendor="${r.isVendor ? "1" : "0"}" data-pos="${i}">
      <span class="lb-medal">${medalEmoji(i)}</span>
      <span class="lb-handle">@${esc(r.handle)}${r.isVendor ? ' <span class="vendor-dot" title="Official vendor">★</span>' : ""}</span>
      <span class="lb-value">${esc(r.value)}</span>
      <span class="lb-detail">${esc(r.detail)}</span>
    </div>`).join("");

  return `
  <div class="trophy-card" style="--accent:${t.color.accent};--card-bg:${t.color.bg};--card-border:${t.color.border};--medal:${t.color.medal}">
    <div class="trophy-header">
      <span class="trophy-icon">${t.icon}</span>
      <div>
        <div class="trophy-title">${esc(t.title)}</div>
        <div class="trophy-subtitle">${esc(t.subtitle)}</div>
      </div>
      <button class="dl-btn" onclick="downloadCard(this, '${t.id}')">↓ PNG</button>
    </div>
    <div class="trophy-winner-bar">
      <span class="winner-crown">👑</span>
      <span class="winner-name">@${esc(t.winner.handle)}</span>
      <span class="winner-value">${t.entries[0].value}</span>
    </div>
    <div class="lb-list">${rows}</div>
    <div class="trophy-insight">${esc(t.insight)}</div>
    <div class="trophy-tweet">
      <div class="tweet-text" id="tw-${idx}">${esc(t.tweetHook)}</div>
      <button class="copy-btn" onclick="copyTweet(${idx})">Copy tweet</button>
    </div>
  </div>`;
}

function renderGoat(g: (typeof goats)[0], rank: number): string {
  const badge = rank === 0 ? "👑 GOAT" : rank === 1 ? "🥈 Runner-up" : "🥉 All-rounder";
  return `
  <div class="goat-card" data-vendor="${g.profile.isVendor ? "1" : "0"}">
    <div class="goat-rank">${badge}</div>
    <div class="goat-handle">@${esc(g.handle)}${g.profile.isVendor ? ' <span class="vendor-dot">★</span>' : ""}</div>
    <div class="goat-stats">
      <span>${g.profile.skillCount} skills</span>
      <span>${fmt(g.profile.totalStars)} ⭐ total</span>
      <span>${fmt(g.profile.totalInstalls)} installs</span>
    </div>
    <div class="goat-trophies">${g.trophies.map((t) => `<span class="goat-trophy">${esc(t)}</span>`).join("")}</div>
  </div>`;
}

const trophyData = JSON.stringify(trophies.map((t) => t.tweetHook));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>omgskills Creator Leaderboards</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f2;color:#1a1a1a}

/* ── Header ── */
header{background:#fff;border-bottom:1px solid #e5e5e0;padding:20px 32px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:18px;font-weight:700}
.tagline{font-size:13px;color:#888;margin-left:4px}
.badge{font-size:11px;background:#f0f0ed;border:1px solid #ddd;border-radius:99px;padding:2px 10px;color:#888}
.meta{font-size:12px;color:#bbb;margin-left:auto}

/* ── Layout ── */
.page{max-width:1100px;margin:0 auto;padding:32px 24px;display:flex;flex-direction:column;gap:40px}

/* ── Contrast callout ── */
.contrast{background:#fff;border:1px solid #e5e5e0;border-radius:14px;padding:24px 28px}
.contrast-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:16px}
.contrast-headline{font-size:20px;font-weight:800;color:#111;line-height:1.3;margin-bottom:20px}
.contrast-cols{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start}
.contrast-col h3{font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:10px}
.contrast-col.stars h3{color:#d97706}
.contrast-col.installs h3{color:#ea580c}
.contrast-col.both h3{color:#16a34a;text-align:center}
.contrast-handle{font-size:14px;font-weight:600;color:#333;padding:4px 0;display:block}
.contrast-divider{width:1px;background:#e5e5e0;align-self:stretch;margin:20px 0}
.contrast-insight{margin-top:16px;font-size:13px;color:#555;line-height:1.5;background:#f9f9f7;border-radius:8px;padding:12px 14px;border-left:3px solid #e5e5e0}

/* ── GOAT section ── */
.goat-section h2{font-size:15px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.goat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.goat-card{background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:16px 18px}
.goat-rank{font-size:11px;font-weight:700;letter-spacing:.4px;color:#888;text-transform:uppercase;margin-bottom:6px}
.goat-handle{font-size:16px;font-weight:700;color:#111;margin-bottom:8px}
.goat-stats{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#666;margin-bottom:10px}
.goat-stats span{background:#f5f5f2;border-radius:99px;padding:2px 8px}
.goat-trophies{display:flex;flex-direction:column;gap:4px}
.goat-trophy{font-size:12px;color:#555;padding:2px 0}

/* ── Trophy grid ── */
.trophy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.trophy-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.trophy-header{display:flex;gap:12px;align-items:center;padding:16px 18px 12px;border-bottom:1px solid var(--card-border)}
.trophy-icon{font-size:22px}
.trophy-title{font-size:15px;font-weight:700;color:#111}
.trophy-subtitle{font-size:11px;color:#999;margin-top:2px}
.trophy-winner-bar{display:flex;align-items:center;gap:8px;background:var(--medal);background:linear-gradient(135deg,var(--medal),var(--accent));padding:10px 18px}
.winner-crown{font-size:14px}
.winner-name{font-size:14px;font-weight:700;color:#fff;flex:1}
.winner-value{font-size:13px;color:rgba(255,255,255,.85);font-weight:600}
.lb-list{padding:10px 14px;display:flex;flex-direction:column;gap:2px;flex:1}
.lb-row{display:grid;grid-template-columns:24px 1fr auto;column-gap:8px;align-items:baseline;padding:5px 4px;border-radius:6px;font-size:12px}
.lb-row:hover{background:rgba(0,0,0,.03)}
.lb-winner{font-weight:600}
.lb-medal{font-size:14px;text-align:center}
.lb-handle{color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-value{color:var(--accent);font-weight:600;white-space:nowrap;text-align:right}
.lb-detail{grid-column:2/-1;color:#aaa;font-size:11px;margin-top:-2px}
.trophy-insight{margin:0 14px 12px;font-size:12px;color:#555;line-height:1.5;background:#fff;border-radius:8px;padding:10px 12px}
.trophy-tweet{margin:0 14px 16px;display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid #e9e9e6;border-radius:8px;padding:10px 12px}
.tweet-text{flex:1;font-size:12px;color:#333;line-height:1.45}
.copy-btn{flex-shrink:0;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.copy-btn:hover{opacity:.85}
.copy-btn.copied{background:#16a34a}
.vendor-dot{color:#2563eb;font-size:10px;vertical-align:super}

/* ── Filter buttons ── */
.filter-btns{display:flex;gap:4px;margin-left:8px}
.filter-btn{background:#f0f0ed;border:1px solid #ddd;border-radius:99px;padding:4px 12px;font-size:12px;font-weight:500;color:#666;cursor:pointer;transition:all .15s}
.filter-btn:hover{background:#e5e5e0;color:#333}
.filter-btn.active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}

/* ── Hidden by filter / overflow ── */
.lb-row.hidden{display:none}
.lb-row.overflow-hidden{display:none}
.goat-card.hidden{display:none}
.trophy-card.all-hidden .lb-list::after{content:"No results for this filter";display:block;text-align:center;color:#bbb;font-size:12px;padding:12px 0}

/* ── Download button ── */
.dl-btn{margin-left:auto;background:transparent;border:1px solid var(--card-border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer;transition:all .15s;flex-shrink:0}
.dl-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.dl-btn.loading{opacity:.5;cursor:wait}
</style>
</head>
<body>

<header>
  <h1>omgskills Creator Leaderboards</h1>
  <span class="tagline">— Who really runs the Claude skill ecosystem?</span>
  <span class="badge">${authors.filter(a=>a.skillCount>=2).length} creators ranked</span>
  <span class="badge">${trophies.length} trophy categories</span>
  <div class="filter-btns">
    <button class="filter-btn active" data-filter="all">All creators</button>
    <button class="filter-btn" data-filter="community">Community only</button>
    <button class="filter-btn" data-filter="vendor">Official only</button>
  </div>
  <span class="meta">${skills.length.toLocaleString()} skills indexed</span>
</header>

<div class="page">

  <!-- ── Contrast callout ── -->
  <div class="contrast">
    <div class="contrast-title">📊 The Two Economies</div>
    <div class="contrast-headline">Stars and installs rank creators completely differently — they measure different kinds of greatness.</div>
    <div class="contrast-cols">
      <div class="contrast-col stars">
        <h3>⭐ Stars only (top 5)</h3>
        ${starsTop5.map((h) => {
          const isV = authors.find((author) => author.handle === h)?.isVendor ?? false;
          return `<span class="contrast-handle" data-vendor="${isV ? "1" : "0"}">@${esc(h)}${isV ? ' <span class="vendor-dot">★</span>' : ""}</span>`;
        }).join("")}
      </div>
      <div class="contrast-divider"></div>
      ${overlap.length > 0 ? `<div class="contrast-col both">
        <h3>✓ Both top 5s</h3>
        ${overlap.map((h) => {
          const isV = authors.find((author) => author.handle === h)?.isVendor ?? false;
          return `<span class="contrast-handle" data-vendor="${isV ? "1" : "0"}" style="text-align:center">@${esc(h)}${isV ? ' <span class="vendor-dot">★</span>' : ""}</span>`;
        }).join("")}
      </div>
      <div class="contrast-divider"></div>` : ""}
      <div class="contrast-col installs">
        <h3>⚡ Installs only (top 5)</h3>
        ${installsTop5.map((h) => {
          const isV = authors.find((author) => author.handle === h)?.isVendor ?? false;
          return `<span class="contrast-handle" data-vendor="${isV ? "1" : "0"}">@${esc(h)}${isV ? ' <span class="vendor-dot">★</span>' : ""}</span>`;
        }).join("")}
      </div>
    </div>
    <div class="contrast-insight">
      ${overlap.length === 0
        ? "Zero overlap — the stars top 5 and the installs top 5 are completely different people. Stars measure ecosystem reputation. Installs measure real-world utility. They're almost orthogonal signals."
        : `Only ${overlap.length} creator${overlap.length > 1 ? "s" : ""} (${overlap.map(h=>"@"+h).join(", ")}) appear${overlap.length===1?"s":""} in both top 5s. The two rankings are almost entirely different people — stars and installs measure different things.`}
    </div>
  </div>

  <!-- ── GOAT section ── -->
  ${goats.length > 0 ? `
  <div class="goat-section">
    <h2>🏅 All-Rounders — Top 5 in 3+ Categories</h2>
    <div class="goat-grid">
      ${goats.map((g, i) => renderGoat(g, i)).join("")}
    </div>
  </div>` : ""}

  <!-- ── Trophy grid ── -->
  <div class="trophy-grid">
    ${trophies.map((t, i) => renderTrophy(t, i)).join("")}
  </div>

</div>

<script>
const TWEETS = ${trophyData};

function copyTweet(i) {
  navigator.clipboard.writeText(TWEETS[i]).then(() => {
    const btn = document.querySelectorAll('.copy-btn')[i];
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy tweet'; btn.classList.remove('copied'); }, 2000);
  });
}

async function downloadCard(btn, id) {
  const card = btn.closest('.trophy-card');
  btn.classList.add('loading');
  btn.textContent = '…';

  // Elements to hide during capture (UI chrome, not content)
  // Use display:none so they don't leave a gap in the PNG
  const hideEls = card.querySelectorAll('.trophy-tweet, .dl-btn');
  hideEls.forEach(el => el.style.display = 'none');

  // Add a small watermark footer during capture
  const watermark = document.createElement('div');
  watermark.style.cssText = 'padding:10px 18px 14px;font-size:11px;color:#bbb;text-align:right;font-family:-apple-system,sans-serif';
  watermark.textContent = 'omgskills.com';
  card.appendChild(watermark);

  try {
    const canvas = await html2canvas(card, {
      scale: 2,
      backgroundColor: null,
      useCORS: true,
      logging: false,
    });

    const a = document.createElement('a');
    a.download = 'omgskills-' + id + '-leaderboard.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } finally {
    card.removeChild(watermark);
    hideEls.forEach(el => el.style.display = '');
    btn.classList.remove('loading');
    btn.textContent = '↓ PNG';
  }
}

// ── Filter logic ──
const MEDALS = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
const MAX_VISIBLE = 10;

function applyFilter(filter) {
  // Update button states
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  // Filter leaderboard rows — show top 10 matching, re-medal them
  document.querySelectorAll('.trophy-card').forEach(card => {
    const rows = Array.from(card.querySelectorAll('.lb-row'));
    let visibleCount = 0;

    rows.forEach(row => {
      const isVendor = row.dataset.vendor === '1';
      const filteredOut = (filter === 'community' && isVendor) || (filter === 'vendor' && !isVendor);
      const overLimit = !filteredOut && visibleCount >= MAX_VISIBLE;
      const hide = filteredOut || overLimit;

      row.classList.toggle('hidden', filteredOut);
      row.classList.toggle('overflow-hidden', overLimit);

      if (!filteredOut && visibleCount < MAX_VISIBLE) {
        row.classList.toggle('lb-winner', visibleCount === 0);
        row.querySelector('.lb-medal').textContent = MEDALS[visibleCount] ?? String(visibleCount + 1);
        visibleCount++;
      }
    });

    card.classList.toggle('all-hidden', visibleCount === 0);
  });

  // Filter GOAT cards
  document.querySelectorAll('.goat-card').forEach(card => {
    const isVendor = card.dataset.vendor === '1';
    const hide = (filter === 'community' && isVendor) || (filter === 'vendor' && !isVendor);
    card.classList.toggle('hidden', hide);
  });

  // Dim contrast callout handles that don't match filter
  document.querySelectorAll('.contrast-handle').forEach(el => {
    const isVendor = el.dataset.vendor === '1';
    const hide = (filter === 'community' && isVendor) || (filter === 'vendor' && !isVendor);
    el.style.opacity = hide ? '0.25' : '1';
  });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
});
</script>

</body>
</html>`;

writeFileSync(outPath, html);
console.log(`Written: ${outPath}`);
console.log(`  ${trophies.length} trophies · ${goats.length} GOATs · ${authors.filter(a=>a.skillCount>=2).length} creators ranked`);
console.log(`\nContrast: Stars top 5: ${starsTop5.join(", ")}`);
console.log(`          Installs top 5: ${installsTop5.join(", ")}`);
console.log(`          Overlap: ${overlap.length === 0 ? "ZERO — completely different people" : overlap.join(", ")}`);
