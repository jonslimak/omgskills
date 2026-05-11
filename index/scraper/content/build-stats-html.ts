/**
 * Generates index/stats-report.html — a readable browser report
 * of the compute-stats findings, with one-click tweet hook copying.
 *
 * Usage: npm run content:stats-html
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const statsPath = join(here, "..", "..", "stats.json");
const outPath = join(here, "..", "..", "stats-report.html");

const stats = JSON.parse(readFileSync(statsPath, "utf8"));

const SECTION_ICONS: Record<string, string> = {
  install_power_law:    "⚡",
  hidden_gems:          "💎",
  official_vs_community:"🏢",
  stars_power_law:      "⭐",
  niche_breakdown:      "🗂️",
  tag_intelligence:     "🏷️",
  author_intelligence:  "✍️",
  github_health:        "🏥",
  signal_correlations:  "📊",
};

const SECTION_COLORS: Record<string, { bg: string; accent: string; border: string }> = {
  install_power_law:    { bg: "#fff7ed", accent: "#ea580c", border: "#fed7aa" },
  hidden_gems:          { bg: "#f0fdf4", accent: "#16a34a", border: "#bbf7d0" },
  official_vs_community:{ bg: "#eff6ff", accent: "#2563eb", border: "#bfdbfe" },
  stars_power_law:      { bg: "#fefce8", accent: "#ca8a04", border: "#fde68a" },
  niche_breakdown:      { bg: "#fdf4ff", accent: "#9333ea", border: "#e9d5ff" },
  tag_intelligence:     { bg: "#f0fdfa", accent: "#0d9488", border: "#99f6e4" },
  author_intelligence:  { bg: "#fff1f2", accent: "#e11d48", border: "#fecdd3" },
  github_health:        { bg: "#f0fdf4", accent: "#15803d", border: "#bbf7d0" },
  signal_correlations:  { bg: "#f8fafc", accent: "#1e40af", border: "#bfdbfe" },
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDataBlock(data: unknown, depth = 0): string {
  if (data === null || data === undefined) return '<span class="null">null</span>';
  if (typeof data === "number") return `<span class="num">${data.toLocaleString()}</span>`;
  if (typeof data === "string") return `<span class="str">${esc(data)}</span>`;
  if (typeof data === "boolean") return `<span class="bool">${data}</span>`;

  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    // Flat array of primitives → inline
    if (data.every((v) => typeof v !== "object")) {
      return `[${data.map((v) => renderDataBlock(v)).join(", ")}]`;
    }
    // Array of objects → table if consistent shape
    if (typeof data[0] === "object" && data[0] !== null) {
      const keys = Object.keys(data[0]);
      const sample = data.slice(0, 20);
      return `<div class="data-table-wrap"><table class="data-table">
        <thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
        <tbody>${sample.map((row: any) =>
          `<tr>${keys.map((k) => `<td>${renderDataBlock(row[k])}</td>`).join("")}</tr>`
        ).join("")}</tbody>
      </table>${data.length > 20 ? `<div class="truncated">… ${data.length - 20} more rows</div>` : ""}</div>`;
    }
    return `[${data.map((v) => renderDataBlock(v)).join(", ")}]`;
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    return `<dl class="data-dl">${entries.map(([k, v]) =>
      `<div class="dl-row"><dt>${esc(k)}</dt><dd>${renderDataBlock(v, depth + 1)}</dd></div>`
    ).join("")}</dl>`;
  }

  return esc(String(data));
}

function sectionCard(s: any, i: number): string {
  const colors = SECTION_COLORS[s.id] ?? { bg: "#f9f9f7", accent: "#555", border: "#e5e5e0" };
  const icon = SECTION_ICONS[s.id] ?? "📌";

  const tweetHooks = (s.tweet_hooks ?? []).map((hook: string, hi: number) => `
    <div class="tweet-hook" id="hook-${i}-${hi}">
      <div class="tweet-text">${esc(hook)}</div>
      <button class="copy-btn" onclick="copyHook(${i},${hi})">Copy</button>
    </div>`).join("");

  return `
  <section class="card" style="--accent:${colors.accent};--card-bg:${colors.bg};--card-border:${colors.border}">
    <div class="card-header">
      <span class="card-icon">${icon}</span>
      <div class="card-meta">
        <span class="card-id">${esc(s.id.replace(/_/g, " ").toUpperCase())}</span>
        <h2 class="card-hook">${esc(s.hook)}</h2>
      </div>
    </div>

    <div class="card-body">
      <div class="angle-bar">
        <span class="angle-label">💡</span>
        <p class="angle-text">${esc(s.angle)}</p>
      </div>

      ${tweetHooks ? `<div class="tweet-section">
        <div class="tweet-section-label">Tweet hooks</div>
        ${tweetHooks}
      </div>` : ""}

      <details class="data-details">
        <summary>Raw data</summary>
        <div class="data-inner">${renderDataBlock(s.data)}</div>
      </details>
    </div>
  </section>`;
}

const tweetData = JSON.stringify(
  stats.sections.map((s: any) => s.tweet_hooks ?? [])
);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>omgskills Stats Report</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f2;color:#1a1a1a;min-height:100vh}
header{background:#fff;border-bottom:1px solid #e5e5e0;padding:20px 32px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
h1{font-size:18px;font-weight:700;color:#111}
.meta{font-size:12px;color:#999;margin-left:auto}
.badge{font-size:11px;background:#f0f0ed;border:1px solid #ddd;border-radius:99px;padding:2px 10px;color:#888}

.grid{max-width:900px;margin:32px auto;padding:0 24px;display:flex;flex-direction:column;gap:24px}

.card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card-header{display:flex;gap:14px;align-items:flex-start;padding:20px 24px 16px;border-bottom:1px solid var(--card-border)}
.card-icon{font-size:24px;line-height:1;flex-shrink:0;margin-top:2px}
.card-meta{flex:1;min-width:0}
.card-id{font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--accent);display:block;margin-bottom:4px}
.card-hook{font-size:17px;font-weight:700;color:#111;line-height:1.35}
.card-body{padding:18px 24px;display:flex;flex-direction:column;gap:14px}

.angle-bar{display:flex;gap:10px;background:#fff;border-radius:8px;padding:12px 14px;border:1px solid #e9e9e6}
.angle-label{font-size:16px;flex-shrink:0}
.angle-text{font-size:13px;color:#444;line-height:1.55}

.tweet-section{display:flex;flex-direction:column;gap:8px}
.tweet-section-label{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#aaa}
.tweet-hook{display:flex;align-items:flex-start;gap:10px;background:#fff;border:1px solid #e5e5e0;border-radius:8px;padding:10px 12px}
.tweet-text{flex:1;font-size:13px;color:#333;line-height:1.5}
.copy-btn{flex-shrink:0;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.copy-btn:hover{opacity:.85}
.copy-btn.copied{background:#16a34a}

details.data-details{border-radius:8px;overflow:hidden}
details summary{font-size:12px;color:#aaa;cursor:pointer;padding:6px 2px;user-select:none;list-style:none}
details summary::before{content:"▶ "}
details[open] summary::before{content:"▼ "}
.data-inner{margin-top:10px;background:#fff;border:1px solid #e9e9e6;border-radius:8px;padding:14px;overflow-x:auto}

.data-dl{display:flex;flex-direction:column;gap:6px}
.dl-row{display:flex;gap:12px;flex-wrap:wrap;font-size:12px}
dt{color:#888;min-width:120px;font-weight:500;flex-shrink:0}
dd{color:#222;flex:1}

.data-table-wrap{overflow-x:auto}
.data-table{border-collapse:collapse;font-size:11px;width:100%}
.data-table th{text-align:left;padding:5px 10px;color:#888;border-bottom:2px solid #e5e5e0;white-space:nowrap;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.3px}
.data-table td{padding:5px 10px;border-bottom:1px solid #f0f0ed;vertical-align:top}
.data-table tr:last-child td{border-bottom:none}
.data-table tr:hover td{background:#fafaf8}
.truncated{font-size:11px;color:#aaa;padding:6px 10px;text-align:center}
.num{color:#2563eb;font-variant-numeric:tabular-nums}
.str{color:#333}
.bool{color:#9333ea}
.null{color:#aaa}
</style>
</head>
<body>
<header>
  <h1>omgskills Stats Report</h1>
  <span class="badge">${stats.sections.length} insights</span>
  <span class="badge">${stats.sections.reduce((s: number, sec: any) => s + (sec.tweet_hooks?.length ?? 0), 0)} tweet hooks</span>
  <span class="meta">Generated ${new Date(stats.generated_at).toLocaleString()} · ${stats.total_skills.toLocaleString()} skills indexed</span>
</header>

<div class="grid">
  ${stats.sections.map((s: any, i: number) => sectionCard(s, i)).join("\n")}
</div>

<script>
const HOOKS = ${tweetData};

function copyHook(si, hi) {
  const text = HOOKS[si][hi];
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('hook-' + si + '-' + hi).querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
</script>
</body>
</html>`;

writeFileSync(outPath, html);
console.log(`Written: ${outPath}`);
console.log(`  ${stats.sections.length} sections · ${stats.sections.reduce((s: number, sec: any) => s + (sec.tweet_hooks?.length ?? 0), 0)} tweet hooks`);
