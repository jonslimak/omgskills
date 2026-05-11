/**
 * Generates index/gold-basket-review.html — a searchable/sortable table
 * for manually reviewing the gold basket.
 *
 * Usage: tsx scraper/content/build-review-html.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const basketPath = join(here, "..", "..", "gold-basket.json");
const outPath = join(here, "..", "..", "gold-basket-review.html");

interface GoldSkill {
  id: string;
  name: string;
  description: string;
  niche: string;
  niche_label: string;
  score: number;
  installs: number;
  stars: number;
  author_handle: string;
  github_url: string;
  externally_validated: boolean;
  trending_rank: number | null;
  // enriched fields (optional — present after enrich-gold-basket)
  gh_forks?: number;
  gh_watchers?: number;
  gh_open_issues?: number;
  gh_days_since_push?: number;
}

const basket: GoldSkill[] = JSON.parse(readFileSync(basketPath, "utf8"));
const isEnriched = basket.some((s) => s.gh_forks !== undefined);

const rows = basket.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  niche_label: s.niche_label,
  score: s.score,
  installs: s.installs,
  stars: s.stars,
  author: s.author_handle,
  github_url: s.github_url,
  ext: s.externally_validated,
  src: (s as any).external_source_count ?? 0,
  vendor: (s as any).official_vendor ?? false,
  rank: s.trending_rank,
  forks: s.gh_forks ?? null,
  watchers: s.gh_watchers ?? null,
  issues: s.gh_open_issues ?? null,
  stale_days: s.gh_days_since_push ?? null,
}));

const niches = [...new Set(basket.map((s) => s.niche_label))].sort();

const dataJson = JSON.stringify(rows);
const nichesJson = JSON.stringify(niches);

// These JS snippets contain chars that confuse TS template literal parsing (${}),
// so they are defined as TS strings and interpolated rather than written inline.
const jsHlFn = [
  "function hl(text,q){",
  "  if(!q)return esc(text);",
  "  var safe=esc(text);",
  "  var re=new RegExp('('+q.replace(/[.*+?^" + "$" + "{}()|[\\]\\\\]/g,'\\\\$&"+"')+')','gi');",
  "  return safe.replace(re,'<mark>$1</mark>');",
  "}",
].join("\n");

// sortDir default comparator (uses ?? which is fine in TS template but
// confusing with brace-matching; keep isolated)
const jsSortFn = [
  "out.sort(function(a,b){",
  "  var av=a[sortCol]!=null?a[sortCol]:-Infinity;",
  "  var bv=b[sortCol]!=null?b[sortCol]:-Infinity;",
  "  if(typeof av==='number')return(av-bv)*sortDir;",
  "  return String(av).localeCompare(String(bv))*sortDir;",
  "});",
].join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>omgskills Gold Basket — ${basket.length} skills${isEnriched ? " (enriched)" : ""}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9f9f7;color:#1a1a1a;display:flex;flex-direction:column;overflow:hidden}
header{flex-shrink:0;padding:18px 24px;border-bottom:1px solid #e5e5e0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff}
h1{font-size:17px;font-weight:600;color:#111}
.badge{font-size:11px;background:#f0f0ed;border:1px solid #ddd;border-radius:99px;padding:2px 10px;color:#888}
.controls{flex-shrink:0;padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #e5e5e0;background:#fff}
input[type=search]{background:#f5f5f2;border:1px solid #ddd;border-radius:7px;padding:6px 12px;color:#1a1a1a;font-size:13px;width:220px;outline:none}
input[type=search]:focus{border-color:#999;background:#fff}
select{background:#f5f5f2;border:1px solid #ddd;border-radius:7px;padding:6px 12px;color:#1a1a1a;font-size:13px;outline:none;cursor:pointer}
select:focus{border-color:#999}
.count{font-size:12px;color:#aaa;margin-left:auto}
.wrap{flex:1;overflow:auto;min-height:0}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:920px}
thead{position:sticky;top:0;z-index:10;background:#fff}
th{padding:9px 14px;text-align:left;color:#aaa;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e5e5e0;cursor:pointer;user-select:none;white-space:nowrap}
th.sort-desc::after{content:' ▼';color:#16a34a;font-size:9px}
th.sort-asc::after{content:' ▲';color:#16a34a;font-size:9px}
th[data-col]:hover{color:#555}
tbody tr{border-bottom:1px solid #ebebea;transition:background .08s}
tbody tr:hover{background:#f4f4f1}
td{padding:9px 14px;vertical-align:top}
.name a{font-weight:500;color:#111;text-decoration:none}
.name a:hover{color:#2563eb}
.skill-id{font-size:10px;color:#bbb;font-family:ui-monospace,monospace;margin-top:2px}
.desc{color:#666;line-height:1.45;max-width:320px}
.pill{display:inline-block;font-size:10px;font-weight:500;padding:2px 8px;border-radius:99px;white-space:nowrap}
.score-num{font-weight:600;font-size:15px;color:#111}
.bar-bg{height:3px;background:#e5e5e0;border-radius:2px;margin-top:5px;width:56px}
.bar-fg{height:3px;border-radius:2px;background:linear-gradient(90deg,#16a34a,#0891b2)}
.num{font-variant-numeric:tabular-nums;color:#333}
.dim{color:#bbb;font-size:12px}
.stale{color:#f97316;font-size:11px;font-weight:500}
.fresh{color:#16a34a;font-size:11px}
.ext{font-size:10px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;padding:1px 7px;border-radius:4px;white-space:nowrap}
.author{color:#4f46e5;font-size:12px}
mark{background:#fef08a;color:#000;border-radius:2px;padding:0 1px}
</style>
</head>
<body>
<header>
  <h1>omgskills Gold Basket</h1>
  <span class="badge" id="hdr-count">${basket.length} skills</span>
  ${isEnriched ? '<span class="badge" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0">GitHub enriched</span>' : '<span class="badge" style="color:#f97316;border-color:#fed7aa">Run content:enrich-basket for GitHub signals</span>'}
</header>

<div class="controls">
  <input type="search" id="q" placeholder="Search skills…" autocomplete="off">
  <select id="niche-sel">
    <option value="">All niches</option>
  </select>
  <select id="ext-sel">
    <option value="">All</option>
    <option value="vendor">Official vendor</option>
    <option value="1">1+ list</option>
    <option value="2">2+ lists</option>
    <option value="0">No validation</option>
  </select>
  <span class="count" id="count-lbl"></span>
</div>

<div class="wrap">
<table>
  <thead>
    <tr>
      <th data-col="name">Skill</th>
      <th style="width:300px">Description</th>
      <th data-col="niche_label">Niche</th>
      <th data-col="score" class="sort-desc">Score</th>
      <th data-col="installs">Installs</th>
      <th data-col="stars">Stars</th>
      <th data-col="forks">Forks</th>
      <th data-col="watchers">Watchers</th>
      <th data-col="stale_days">Last Push</th>
      <th data-col="rank">Trend #</th>
      <th data-col="author">Author</th>
      <th>Validated</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>
</div>

<script>
const DATA = ${dataJson};
const NICHES = ${nichesJson};

const NICHE_STYLE = {
  'AI Orchestration':          {bg:'#ede9fe',fg:'#6d28d9'},
  'Coding Productivity':       {bg:'#dcfce7',fg:'#15803d'},
  'Content & Marketing':       {bg:'#fef9c3',fg:'#a16207'},
  'Data & Analytics':          {bg:'#fce7f3',fg:'#9d174d'},
  'Design & UI':               {bg:'#f3e8ff',fg:'#7e22ce'},
  'DevOps & CI/CD':            {bg:'#e0f2fe',fg:'#0369a1'},
  'MCP Servers':               {bg:'#fdf4ff',fg:'#86198f'},
  'Research & Summarization':  {bg:'#f0fdf4',fg:'#166534'},
  'Web Scraping & Automation': {bg:'#fff7ed',fg:'#c2410c'},
  'Writing & Documentation':   {bg:'#eff6ff',fg:'#1d4ed8'},
};

function fmt(n){
  if(n==null)return'—';
  if(n>=1e6)return(n/1e6).toFixed(1)+'M';
  if(n>=1e3)return(n/1e3).toFixed(1)+'k';
  return String(n);
}

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

${jsHlFn}

// Populate niche select
const nicheEl=document.getElementById('niche-sel');
NICHES.forEach(n=>{
  const o=document.createElement('option');
  o.value=n; o.textContent=n;
  nicheEl.appendChild(o);
});

const tbody=document.getElementById('tbody');
const qEl=document.getElementById('q');
const extEl=document.getElementById('ext-sel');
const countEl=document.getElementById('count-lbl');

let sortCol='score', sortDir=-1;
const maxScore=Math.max(...DATA.map(r=>r.score));

function validationBadge(r){
  if(r.vendor&&r.src>=2) return '<span class="ext" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe">★ official · '+r.src+' lists</span>';
  if(r.vendor)           return '<span class="ext" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe">★ official</span>';
  if(r.src>=2)           return '<span class="ext">✓ '+r.src+' lists</span>';
  if(r.src===1)          return '<span class="ext" style="background:#fffbeb;color:#b45309;border-color:#fde68a">1 list</span>';
  return '';
}

function render(){
  const q=qEl.value.trim().toLowerCase();
  const niche=nicheEl.value;
  const extFilter=extEl.value;

  let out=DATA.filter(r=>{
    if(niche&&r.niche_label!==niche)return false;
    if(extFilter==='vendor'&&!r.vendor)return false;
    if(extFilter==='1'&&r.src<1)return false;
    if(extFilter==='2'&&r.src<2)return false;
    if(extFilter==='0'&&(r.src>0||r.vendor))return false;
    if(q){
      const hay=(r.name+' '+r.description+' '+r.author+' '+r.id).toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });

  ${jsSortFn}

  countEl.textContent=out.length+' / '+DATA.length+' skills';

  tbody.innerHTML=out.map(r=>{
    const ns=NICHE_STYLE[r.niche_label]||{bg:'#1a1a1a',fg:'#aaa'};
    const pill='<span class="pill" style="background:'+ns.bg+';color:'+ns.fg+'">'+esc(r.niche_label)+'</span>';
    const barW=Math.round(r.score/maxScore*100);
    const bar='<div class="bar-bg"><div class="bar-fg" style="width:'+barW+'%"></div></div>';
    var staleTd='<td class="dim">—</td>';
    if(r.stale_days!=null){
      var mo=Math.round(r.stale_days/30);
      if(r.stale_days>365) staleTd='<td><span class="stale">'+mo+'mo ago</span></td>';
      else if(r.stale_days>180) staleTd='<td><span class="stale" style="color:#eab308">'+mo+'mo ago</span></td>';
      else staleTd='<td><span class="fresh">'+(r.stale_days<7?r.stale_days+'d':mo+'mo')+' ago</span></td>';
    }
    return '<tr>'
      +'<td class="name">'
        +'<a href="'+esc(r.github_url)+'" target="_blank" rel="noopener">'+hl(r.name,q)+'</a>'
        +'<div class="skill-id">'+esc(r.id)+'</div>'
      +'</td>'
      +'<td><div class="desc">'+hl(r.description||'',q)+'</div></td>'
      +'<td>'+pill+'</td>'
      +'<td><div class="score-num">'+r.score+'</div>'+bar+'</td>'
      +'<td class="num">'+fmt(r.installs)+'</td>'
      +'<td class="num">'+fmt(r.stars)+'</td>'
      +'<td class="num">'+(r.forks!=null?fmt(r.forks):'—')+'</td>'
      +'<td class="num">'+(r.watchers!=null?fmt(r.watchers):'—')+'</td>'
      +staleTd
      +'<td class="num dim">'+(r.rank??'—')+'</td>'
      +'<td class="author">'+hl('@'+r.author,q)+'</td>'
      +'<td>'+validationBadge(r)+'</td>'
      +'</tr>';
  }).join('');
}

document.querySelectorAll('th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    document.querySelectorAll('th').forEach(t=>t.classList.remove('sort-asc','sort-desc'));
    if(sortCol===col){sortDir*=-1;}else{sortCol=col;sortDir=-1;}
    th.classList.add(sortDir===-1?'sort-desc':'sort-asc');
    render();
  });
});

qEl.addEventListener('input',render);
nicheEl.addEventListener('change',render);
extEl.addEventListener('change',render);

render();
</script>
</body>
</html>`;

writeFileSync(outPath, html);
console.log(`Written: ${outPath} (${basket.length} skills)`);
