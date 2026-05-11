/**
 * Combines stats-report.html, leaderboards.html, and growth-report.html
 * into a single tabbed dashboard.html.
 *
 * Each report is embedded as an srcdoc iframe so their CSS/JS stay
 * fully isolated — no class conflicts, no JS global collisions.
 *
 * Run the individual reports first, then run this:
 *   npm run content:stats && npm run content:stats-html
 *   npm run content:leaderboards
 *   npm run content:growth-html
 *   npm run content:dashboard
 *
 * Usage: npm run content:dashboard
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here    = dirname(fileURLToPath(import.meta.url));
const root    = join(here, "..", "..");
const outPath = join(root, "dashboard.html");

function load(filename: string, fallback: string): string {
  const p = join(root, filename);
  if (!existsSync(p)) {
    console.warn(`  [missing] ${filename} — showing placeholder. Run the build script first.`);
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;color:#888">${fallback}</body></html>`;
  }
  return readFileSync(p, "utf8");
}

// Escape for embedding inside a JS template literal (backtick string).
// Critical: also escape </script> so the browser HTML parser doesn't terminate
// the outer <script> block when it encounters it inside a JS string.
function escJS(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/<\/script/gi, "<\\/script");
}

const statsHtml       = load("stats-report.html",       "Run <code>npm run content:stats && npm run content:stats-html</code> first.");
const leaderboardsHtml = load("leaderboards.html",      "Run <code>npm run content:leaderboards</code> first.");
const growthHtml       = load("growth-report.html",     "Run <code>npm run content:growth-html</code> first.");
const basketHtml       = load("gold-basket-review.html","Run <code>npm run content:review-html</code> first.");

const tabs = [
  { id: "stats",        label: "📊 Stats",        html: statsHtml },
  { id: "leaderboards", label: "🏆 Leaderboards",  html: leaderboardsHtml },
  { id: "growth",       label: "📈 Growth",        html: growthHtml },
  { id: "basket",       label: "🧺 Gold Basket",   html: basketHtml },
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>omgskills Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}

/* ── Tab bar ── */
.tab-bar{
  height:52px;
  background:#fff;
  border-bottom:1px solid #e5e5e0;
  display:flex;
  align-items:stretch;
  gap:0;
  padding:0 20px;
  position:relative;
  z-index:10;
}
.tab-btn{
  display:flex;
  align-items:center;
  gap:6px;
  padding:0 18px;
  font-size:13px;
  font-weight:500;
  color:#888;
  background:none;
  border:none;
  border-bottom:2px solid transparent;
  cursor:pointer;
  transition:color .15s, border-color .15s;
  white-space:nowrap;
  margin-bottom:-1px;
}
.tab-btn:hover{color:#333}
.tab-btn.active{color:#111;font-weight:600;border-bottom-color:#111}

.tab-logo{
  margin-right:auto;
  display:flex;
  align-items:center;
  gap:8px;
  font-size:13px;
  font-weight:700;
  color:#111;
  padding-right:20px;
}
.tab-logo .dot{color:#888;font-weight:400}

/* ── Frames ── */
.frame-wrap{
  position:absolute;
  top:52px;
  left:0;right:0;bottom:0;
  display:none;
}
.frame-wrap.active{display:block}

iframe.panel{
  width:100%;
  height:100%;
  border:none;
  display:block;
  background:#f5f5f2;
}
</style>
</head>
<body>

<div class="tab-bar">
  <div class="tab-logo">omgskills <span class="dot">·</span> Data</div>
  ${tabs.map((t, i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("\n  ")}
</div>

${tabs.map((t, i) => `
<div class="frame-wrap${i === 0 ? " active" : ""}" id="wrap-${t.id}">
  <iframe class="panel" id="frame-${t.id}" title="${t.label}"></iframe>
</div>`).join("")}

<script>
const PANELS = {
${tabs.map((t) => `  "${t.id}": \`${escJS(t.html)}\``).join(",\n")}
};

// Lazy-load: inject srcdoc on first activation so page opens instantly
const loaded = new Set();

function showTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.frame-wrap').forEach(w => w.classList.toggle('active', w.id === 'wrap-' + id));

  if (!loaded.has(id)) {
    loaded.add(id);
    document.getElementById('frame-' + id).srcdoc = PANELS[id];
  }
}

// Load first tab immediately
showTab('${tabs[0].id}');

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
<\/script>

</body>
</html>`;

writeFileSync(outPath, html);
console.log(`Written: ${outPath}`);
console.log(`  ${tabs.length} tabs embedded (${tabs.map(t => t.id).join(", ")})`);
