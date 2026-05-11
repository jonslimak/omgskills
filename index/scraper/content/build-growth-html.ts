/**
 * Generates index/growth-report.html — a week-over-week trending growth page.
 *
 * Reads available snapshots from index/snapshots/trending-YYYY-MM-DD.json,
 * compares the two most recent, and shows:
 *   - Biggest install gainers (installs this week vs last)
 *   - New entrants (first time appearing in trending)
 *   - Current top 10 trending with growth indicators
 *   - Summary stats (total installs added, new entries)
 *
 * If only one snapshot exists, shows a "come back next week" message with
 * the current top 10.
 *
 * Usage: npm run content:growth-html
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotsDir = join(here, "..", "..", "snapshots");
const skillsPath   = join(here, "..", "..", "skills.json");
const outPath      = join(here, "..", "..", "growth-report.html");

// ── Types ────────────────────────────────────────────────────────────────────

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

interface Snapshot {
  date: string;
  entries: TrendingEntry[];
}

interface SkillMeta {
  id: string;
  name: string;
  author_handle: string;
  stars: number;
  github_url: string;
  install_cmd: string;
}

interface GrowthRow {
  id: string;
  name: string;
  author: string;
  github_url: string;
  currentInstalls: number;
  prevInstalls: number | null;
  delta: number | null;
  deltaPercent: number | null;
  currentRank: number;
  prevRank: number | null;
  rankDelta: number | null;    // positive = moved up
  isNew: boolean;
  stars: number;
}

// ── Load data ─────────────────────────────────────────────────────────────────

function loadSnapshots(): Snapshot[] {
  if (!existsSync(snapshotsDir)) return [];
  const files = readdirSync(snapshotsDir)
    .filter((f) => /^trending-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // ascending date order
  return files.map((f) => JSON.parse(readFileSync(join(snapshotsDir, f), "utf8")) as Snapshot);
}

function loadSkillMeta(): Map<string, SkillMeta> {
  if (!existsSync(skillsPath)) return new Map();
  const arr = JSON.parse(readFileSync(skillsPath, "utf8")) as SkillMeta[];
  return new Map(arr.map((s) => [s.id, s]));
}

// ── Compute growth ────────────────────────────────────────────────────────────

function computeGrowth(current: Snapshot, prev: Snapshot | null, skillMeta: Map<string, SkillMeta>): GrowthRow[] {
  const prevMap = prev
    ? new Map(prev.entries.map((e) => [e.id, e]))
    : new Map<string, TrendingEntry>();

  return current.entries.map((entry) => {
    const prevEntry = prevMap.get(entry.id) ?? null;
    const meta = skillMeta.get(entry.id);
    const name = meta?.name ?? entry.id.split(":").pop() ?? entry.id;
    const author = meta?.author_handle ?? entry.id.split("/")[0] ?? "";
    const delta = prevEntry !== null ? entry.installs - prevEntry.installs : null;
    const deltaPercent =
      prevEntry !== null && prevEntry.installs > 0
        ? Math.round(((entry.installs - prevEntry.installs) / prevEntry.installs) * 1000) / 10
        : null;
    const rankDelta =
      prevEntry !== null ? prevEntry.trending_rank - entry.trending_rank : null; // positive = climbed

    return {
      id: entry.id,
      name,
      author,
      github_url: meta?.github_url ?? `https://github.com/${entry.id.split(":")[0]}`,
      currentInstalls: entry.installs,
      prevInstalls: prevEntry?.installs ?? null,
      delta,
      deltaPercent,
      currentRank: entry.trending_rank,
      prevRank: prevEntry?.trending_rank ?? null,
      rankDelta,
      isNew: prevEntry === null && prev !== null,
      stars: meta?.stars ?? 0,
    };
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function deltaChip(delta: number | null, deltaPercent: number | null, isNew: boolean): string {
  if (isNew) return `<span class="chip chip-new">✦ NEW</span>`;
  if (delta === null) return `<span class="chip chip-neutral">—</span>`;
  if (delta === 0) return `<span class="chip chip-neutral">→ 0</span>`;
  const sign = delta > 0 ? "+" : "";
  const pctStr = deltaPercent !== null ? ` (${sign}${deltaPercent}%)` : "";
  const cls = delta > 0 ? "chip-up" : "chip-down";
  const arrow = delta > 0 ? "▲" : "▼";
  return `<span class="chip ${cls}">${arrow} ${sign}${fmt(delta)}${pctStr}</span>`;
}

function rankChip(rankDelta: number | null, isNew: boolean): string {
  if (isNew || rankDelta === null) return "";
  if (rankDelta === 0) return `<span class="rank-badge rank-flat">→</span>`;
  if (rankDelta > 0) return `<span class="rank-badge rank-up">▲${rankDelta}</span>`;
  return `<span class="rank-badge rank-down">▼${Math.abs(rankDelta)}</span>`;
}

function skillRow(row: GrowthRow, showDelta: boolean): string {
  const repoUrl = esc(row.github_url);
  return `
  <tr class="skill-row${row.isNew ? " is-new" : ""}">
    <td class="td-rank">#${row.currentRank}${showDelta ? " " + rankChip(row.rankDelta, row.isNew) : ""}</td>
    <td class="td-name">
      <a href="${repoUrl}" target="_blank" class="skill-link">${esc(row.name)}</a>
      <span class="skill-author">@${esc(row.author)}</span>
    </td>
    <td class="td-installs">${fmt(row.currentInstalls)}</td>
    ${showDelta ? `<td class="td-delta">${deltaChip(row.delta, row.deltaPercent, row.isNew)}</td>` : ""}
    <td class="td-stars">⭐ ${fmt(row.stars)}</td>
  </tr>`;
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildTop10Section(rows: GrowthRow[], hasComparison: boolean): string {
  const top10 = rows.slice(0, 10);
  const headers = hasComparison
    ? `<th>Rank</th><th>Skill</th><th>Installs</th><th>This week</th><th>Stars</th>`
    : `<th>Rank</th><th>Skill</th><th>Installs</th><th>Stars</th>`;
  return `
  <section class="section">
    <div class="section-header">
      <span class="section-icon">🔥</span>
      <div>
        <div class="section-label">Top Trending</div>
        <h2 class="section-title">Most Installed This Week</h2>
      </div>
    </div>
    <table class="skill-table">
      <thead><tr>${headers}</tr></thead>
      <tbody>${top10.map((r) => skillRow(r, hasComparison)).join("")}</tbody>
    </table>
  </section>`;
}

function buildGainersSection(rows: GrowthRow[]): string {
  const gainers = rows
    .filter((r) => !r.isNew && r.delta !== null && r.delta > 0)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 10);
  if (gainers.length === 0) return "";
  return `
  <section class="section">
    <div class="section-header">
      <span class="section-icon">📈</span>
      <div>
        <div class="section-label">Biggest Gainers</div>
        <h2 class="section-title">Most New Installs This Week</h2>
      </div>
    </div>
    <table class="skill-table">
      <thead><tr><th>Rank</th><th>Skill</th><th>Installs</th><th>This week</th><th>Stars</th></tr></thead>
      <tbody>${gainers.map((r) => skillRow(r, true)).join("")}</tbody>
    </table>
  </section>`;
}

function buildNewEntrantsSection(rows: GrowthRow[]): string {
  const entrants = rows.filter((r) => r.isNew).slice(0, 10);
  if (entrants.length === 0) return "";
  return `
  <section class="section">
    <div class="section-header">
      <span class="section-icon">✦</span>
      <div>
        <div class="section-label">New Entrants</div>
        <h2 class="section-title">First Time in Trending</h2>
      </div>
    </div>
    <table class="skill-table">
      <thead><tr><th>Rank</th><th>Skill</th><th>Installs</th><th></th><th>Stars</th></tr></thead>
      <tbody>${entrants.map((r) => skillRow(r, true)).join("")}</tbody>
    </table>
  </section>`;
}

function buildFastClimbersSection(rows: GrowthRow[]): string {
  const climbers = rows
    .filter((r) => !r.isNew && r.rankDelta !== null && r.rankDelta >= 5)
    .sort((a, b) => (b.rankDelta ?? 0) - (a.rankDelta ?? 0))
    .slice(0, 10);
  if (climbers.length === 0) return "";
  return `
  <section class="section">
    <div class="section-header">
      <span class="section-icon">🚀</span>
      <div>
        <div class="section-label">Fast Climbers</div>
        <h2 class="section-title">Biggest Rank Jumps</h2>
      </div>
    </div>
    <table class="skill-table">
      <thead><tr><th>Rank</th><th>Skill</th><th>Installs</th><th>This week</th><th>Stars</th></tr></thead>
      <tbody>${climbers.map((r) => skillRow(r, true)).join("")}</tbody>
    </table>
  </section>`;
}

function buildSingleSnapshotView(rows: GrowthRow[], date: string): string {
  const top10 = buildTop10Section(rows, false);
  return `
  <div class="come-back-banner">
    <span class="cb-icon">📅</span>
    <div>
      <strong>First snapshot captured!</strong>
      Run <code>npm run scrape:trending</code> again in a week to unlock week-over-week growth data.
    </div>
  </div>
  ${top10}`;
}

function buildSummaryBar(current: Snapshot, prev: Snapshot, rows: GrowthRow[]): string {
  const totalCurrent = current.entries.reduce((s, e) => s + e.installs, 0);
  const totalPrev    = prev.entries.reduce((s, e) => s + e.installs, 0);
  const totalDelta   = totalCurrent - totalPrev;
  const newCount     = rows.filter((r) => r.isNew).length;
  const dropCount    = prev.entries.filter((pe) => !current.entries.find((ce) => ce.id === pe.id)).length;
  const gainers      = rows.filter((r) => !r.isNew && (r.delta ?? 0) > 0).length;

  return `
  <div class="summary-bar">
    <div class="summary-stat">
      <span class="stat-num">${fmt(totalDelta >= 0 ? totalDelta : 0)}</span>
      <span class="stat-label">New installs this week</span>
    </div>
    <div class="summary-stat">
      <span class="stat-num">${newCount}</span>
      <span class="stat-label">New entrants</span>
    </div>
    <div class="summary-stat">
      <span class="stat-num">${gainers}</span>
      <span class="stat-label">Skills gained installs</span>
    </div>
    <div class="summary-stat">
      <span class="stat-num">${dropCount}</span>
      <span class="stat-label">Dropped off</span>
    </div>
  </div>`;
}

// ── Snapshot nav ──────────────────────────────────────────────────────────────

function buildSnapshotNav(snapshots: Snapshot[], currentIdx: number): string {
  if (snapshots.length <= 1) return "";
  const items = snapshots
    .map((s, i) => {
      const label = i === snapshots.length - 1 ? `${s.date} (latest)` : s.date;
      const cls = i === currentIdx ? "snap-item snap-active" : "snap-item";
      return `<span class="${cls}">${esc(label)}</span>`;
    })
    .join("");
  return `<div class="snap-nav">Snapshots: ${items}</div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const snapshots = loadSnapshots();
  const skillMeta = loadSkillMeta();

  if (snapshots.length === 0) {
    console.error("No snapshots found in index/snapshots/. Run npm run scrape:trending first.");
    process.exit(1);
  }

  const current = snapshots[snapshots.length - 1];
  const prev    = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const hasComparison = prev !== null;

  console.log(`Snapshots found: ${snapshots.length}`);
  console.log(`Current: ${current.date} (${current.entries.length} entries)`);
  if (prev) console.log(`Previous: ${prev.date} (${prev.entries.length} entries)`);

  const rows = computeGrowth(current, prev, skillMeta);

  const bodyContent = hasComparison && prev
    ? `${buildSummaryBar(current, prev, rows)}
       ${buildTop10Section(rows, true)}
       ${buildGainersSection(rows)}
       ${buildNewEntrantsSection(rows)}
       ${buildFastClimbersSection(rows)}`
    : buildSingleSnapshotView(rows, current.date);

  const snapshotNav = buildSnapshotNav(snapshots, snapshots.length - 1);
  const comparisonLabel = hasComparison && prev
    ? `Comparing <strong>${esc(prev.date)}</strong> → <strong>${esc(current.date)}</strong>`
    : `Snapshot from <strong>${esc(current.date)}</strong>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>omgskills · Trending Growth</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f2;color:#1a1a1a;min-height:100vh}

/* Header */
header{background:#fff;border-bottom:1px solid #e5e5e0;padding:18px 32px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.header-title{font-size:18px;font-weight:700;color:#111}
.header-sub{font-size:13px;color:#888;margin-left:auto}
.header-badge{font-size:11px;background:#f0f0ed;border:1px solid #ddd;border-radius:99px;padding:2px 10px;color:#777}

/* Snapshot nav */
.snap-nav{background:#fff;border-bottom:1px solid #e9e9e6;padding:10px 32px;font-size:12px;color:#aaa;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.snap-item{padding:3px 10px;border-radius:99px;border:1px solid #e5e5e0;background:#fafaf8;color:#999}
.snap-active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}

/* Layout */
.page{max-width:860px;margin:32px auto;padding:0 24px;display:flex;flex-direction:column;gap:28px}

/* Summary bar */
.summary-bar{display:flex;gap:0;background:#fff;border:1px solid #e5e5e0;border-radius:14px;overflow:hidden}
.summary-stat{flex:1;padding:18px 20px;text-align:center;border-right:1px solid #f0f0ed}
.summary-stat:last-child{border-right:none}
.stat-num{display:block;font-size:26px;font-weight:700;color:#111;font-variant-numeric:tabular-nums}
.stat-label{display:block;font-size:11px;color:#aaa;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}

/* Come-back banner */
.come-back-banner{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px 22px;display:flex;gap:14px;align-items:flex-start;font-size:14px;color:#1e40af;line-height:1.5}
.cb-icon{font-size:22px;flex-shrink:0}
.come-back-banner code{font-family:monospace;background:#dbeafe;padding:2px 6px;border-radius:4px;font-size:12px}

/* Section */
.section{background:#fff;border:1px solid #e5e5e0;border-radius:14px;overflow:hidden}
.section-header{display:flex;gap:12px;align-items:flex-start;padding:18px 22px 14px;border-bottom:1px solid #f0f0ed}
.section-icon{font-size:22px;line-height:1;flex-shrink:0;margin-top:2px}
.section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#aaa;margin-bottom:3px}
.section-title{font-size:16px;font-weight:700;color:#111}

/* Table */
.skill-table{width:100%;border-collapse:collapse;font-size:13px}
.skill-table thead th{padding:9px 16px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#aaa;border-bottom:1px solid #f0f0ed}
.skill-table td{padding:10px 16px;border-bottom:1px solid #f9f9f7;vertical-align:middle}
.skill-table tr:last-child td{border-bottom:none}
.skill-table tr:hover td{background:#fafaf8}
.is-new td{background:#f0fdf4}
.is-new:hover td{background:#dcfce7}

/* Cells */
.td-rank{color:#aaa;font-size:12px;white-space:nowrap;width:64px}
.td-name{min-width:180px}
.td-installs{font-variant-numeric:tabular-nums;font-weight:600;color:#111;white-space:nowrap}
.td-delta{white-space:nowrap}
.td-stars{color:#888;white-space:nowrap;font-size:12px}

.skill-link{color:#111;font-weight:600;text-decoration:none}
.skill-link:hover{color:#2563eb;text-decoration:underline}
.skill-author{display:block;font-size:11px;color:#aaa;margin-top:1px}

/* Chips */
.chip{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:99px;white-space:nowrap}
.chip-up{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
.chip-down{background:#fff1f2;color:#e11d48;border:1px solid #fecdd3}
.chip-new{background:#fef3c7;color:#d97706;border:1px solid #fde68a}
.chip-neutral{background:#f5f5f2;color:#aaa;border:1px solid #e5e5e0}

/* Rank badges */
.rank-badge{display:inline-flex;font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;margin-left:4px}
.rank-up{background:#dcfce7;color:#16a34a}
.rank-down{background:#fee2e2;color:#dc2626}
.rank-flat{background:#f5f5f2;color:#aaa}

/* Footer */
footer{text-align:center;font-size:11px;color:#ccc;padding:32px 0 48px}
</style>
</head>
<body>
<header>
  <div>
    <div class="header-title">📊 Trending Growth</div>
    <div style="font-size:12px;color:#999;margin-top:2px">${comparisonLabel}</div>
  </div>
  <span class="header-badge">${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""}</span>
  <span class="header-badge">${current.entries.length} skills tracked</span>
  <span class="header-sub">omgskills · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
</header>

${snapshotNav}

<div class="page">
  ${bodyContent}
</div>

<footer>Generated by omgskills · ${new Date().toISOString()}</footer>
</body>
</html>`;

  writeFileSync(outPath, html);
  console.log(`\nWritten: ${outPath}`);
  console.log(`  ${snapshots.length} snapshots · ${current.entries.length} entries · ${hasComparison ? "comparison mode" : "single snapshot mode"}`);
}

main();
