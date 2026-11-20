// The /data/ leaderboards: rendered into the page at build time (scripts/data-page-content.mjs)
// and, when the page has no built content (a local file), in the browser from the same data.

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n || 0));
}

function manifestUrl(track) {
  const base = location.protocol === "file:"
    ? (track === "v2" ? "v2/manifest.json" : "manifest.json")
    : (track === "v2" ? "/data/v2/manifest.json" : "/data/manifest.json");
  return base + "?v=" + Date.now();
}

function assetUrl(path, track) {
  const base = location.protocol === "file:"
    ? (track === "v2" ? "v2/" : "")
    : (track === "v2" ? "/data/v2/" : "/data/");
  return base + path + "?v=" + Date.now();
}

async function loadLeaderboardsFromTrack(track) {
  const manifestResponse = await fetch(manifestUrl(track), { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error("Manifest request failed: " + manifestResponse.status);
  const manifest = await manifestResponse.json();
  if (!manifest.leaderboardViewData?.path) throw new Error("manifest.leaderboardViewData.path is missing");

  const dataResponse = await fetch(assetUrl(manifest.leaderboardViewData.path, track), { cache: "no-cache" });
  if (!dataResponse.ok) throw new Error("Leaderboard view data request failed: " + dataResponse.status);
  const viewData = await dataResponse.json();
  if (!Array.isArray(viewData.topSkills)) throw new Error("Leaderboard view data topSkills must be an array");
  if (!Array.isArray(viewData.creatorCategories)) throw new Error("Leaderboard view data creatorCategories must be an array");
  if (!Array.isArray(viewData.allRounders)) throw new Error("Leaderboard view data allRounders must be an array");
  return { manifest, viewData };
}

export async function loadLeaderboards() {
  try {
    return await loadLeaderboardsFromTrack("v2");
  } catch (error) {
    console.warn("v2 data load failed; falling back to legacy data", error);
    return loadLeaderboardsFromTrack("legacy");
  }
}

// A skill's own page on omgskills when it has one, otherwise its GitHub repo.
function skillAnchor(record, paths) {
  const own = paths?.[record.id];
  if (typeof own === "string" && /^\/(skills|library)\/[^?#\\]+\/$/.test(own) && !own.includes("..")) {
    return `<a class="skill-link" href="${esc(own)}">${esc(record.name)}</a>`;
  }
  return isGithubUrl(record.githubUrl)
    ? `<a class="skill-link" href="${esc(record.githubUrl)}" target="_blank" rel="noreferrer">${esc(record.name)}</a>`
    : `<span class="skill-link">${esc(record.name)}</span>`;
}

// Crawled links: only https GitHub addresses become links.
function isGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

const MEDALS = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
const MAX_VISIBLE = 10;
const MAX_ALL_ROUNDERS_VISIBLE = 15;

function vendorDot(record) {
  return record.isVendor ? ' <span class="vendor-dot" title="Official vendor">★</span>' : "";
}

function renderGoats(records) {
  if (records.length === 0) return "";

  return `
    <section class="goat-section">
      <div class="goat-table-wrap">
        <div class="goat-header">
          <span class="goat-header-icon">🏅</span>
          <div>
            <div class="goat-header-label">Top GOATS</div>
            <h2 class="goat-header-title">All-Rounders</h2>
          </div>
        </div>
        <table class="goat-table">
          <thead>
            <tr>
              <th>Creator</th>
              <th>Skills</th>
              <th>Total Stars</th>
              <th>Installs</th>
              <th>Trophies</th>
            </tr>
          </thead>
          <tbody>
        ${records.map((record) => {
          // Built as Show Corpos off shows it: no vendors, the first 15 others.
          const shown = !record.isVendor && records.filter((other) => !other.isVendor).indexOf(record) < MAX_ALL_ROUNDERS_VISIBLE;
          return `
            <tr class="goat-row${shown ? "" : " hidden"}" data-vendor="${record.isVendor ? "1" : "0"}">
              <td><span class="goat-handle">@${esc(record.authorHandle)}${vendorDot(record)}</span></td>
              <td class="goat-num">${record.skillCount}</td>
              <td class="goat-num">${fmt(record.totalStars)} ⭐</td>
              <td class="goat-num">${fmt(record.totalInstalls)}</td>
              <td><div class="goat-trophies">${record.trophies.map((trophy) => `<span class="goat-trophy">${esc(trophy)}</span>`).join("")}</div></td>
            </tr>`;
        }).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderTrendingSkills(records, paths) {
  const rows = records.slice(0, 10).map((record) => `
    <tr>
      <td class="goat-num">#${record.rank}</td>
      <td>
        ${skillAnchor(record, paths)}
        <span class="skill-author">@${esc(record.authorHandle)}</span>
      </td>
      <td class="goat-num">${fmt(record.installs)}</td>
      <td class="goat-num">${fmt(record.stars)} ⭐</td>
    </tr>`).join("");

  return `
    <section class="trending-section">
      <div class="trending-header">
        <span class="trending-icon">🔥</span>
        <div>
          <div class="trending-label">Top Trending</div>
          <h2 class="trending-title">Most Installed This Week</h2>
        </div>
      </div>
      <div>
        <table class="goat-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Skill</th>
              <th>Installs</th>
              <th>Stars</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderTrophy(category) {
  const winner = category.rows[0];
  // Built as Show Corpos off shows it: vendors hidden, the others ranked, ten shown.
  let shown = 0;
  const rows = category.rows.map((record) => {
    const place = record.isVendor ? -1 : shown++;
    const state = place < 0 ? "hidden" : `${place === 0 ? "lb-winner" : ""} ${place >= MAX_VISIBLE ? "overflow-hidden" : ""}`;
    return `
      <div class="lb-row ${state}" data-vendor="${record.isVendor ? "1" : "0"}">
        <span class="lb-medal">${place < 0 ? "" : MEDALS[place] ?? String(place + 1)}</span>
        <span class="lb-handle">@${esc(record.authorHandle)}${vendorDot(record)}</span>
        <span class="lb-value">${esc(record.value)}</span>
        <span class="lb-detail">${esc(record.detail)}</span>
      </div>`;
  }).join("");

  return `
    <section class="trophy-card" style="--accent:${category.color.accent};--card-bg:${category.color.bg};--card-border:${category.color.border};--medal:${category.color.medal}">
      <div class="trophy-header">
        <span class="trophy-icon">${category.icon}</span>
        <div>
          <div class="trophy-title">${esc(category.title)}</div>
          <div class="trophy-subtitle">${esc(category.subtitle)}</div>
        </div>
      </div>
      ${winner ? `<div class="trophy-winner-bar">
        <span class="winner-crown">👑</span>
        <span class="winner-name">@${esc(winner.authorHandle)}</span>
        <span class="winner-value">${esc(winner.value)}</span>
      </div>` : ""}
      <div class="lb-list">${rows}</div>
      <div class="trophy-insight">${esc(category.insight)}</div>
    </section>`;
}

export function applyFilter(root, showCorpos) {
  root.querySelectorAll(".trophy-card").forEach((card) => {
    const rows = Array.from(card.querySelectorAll(".lb-row"));
    let visibleCount = 0;
    rows.forEach((row) => {
      const isVendor = row.dataset.vendor === "1";
      const filteredOut = !showCorpos && isVendor;
      const overLimit = !filteredOut && visibleCount >= MAX_VISIBLE;
      row.classList.toggle("hidden", filteredOut);
      row.classList.toggle("overflow-hidden", overLimit);
      if (!filteredOut && visibleCount < MAX_VISIBLE) {
        row.classList.toggle("lb-winner", visibleCount === 0);
        row.querySelector(".lb-medal").textContent = MEDALS[visibleCount] ?? String(visibleCount + 1);
        visibleCount++;
      }
    });
    card.classList.toggle("all-hidden", visibleCount === 0);
  });

  const goatRows = Array.from(root.querySelectorAll(".goat-row"));
  const visibleGoatRows = goatRows.filter((row) => showCorpos || row.dataset.vendor !== "1");
  goatRows.forEach((row) => {
    const isVendor = row.dataset.vendor === "1";
    const visibleIndex = visibleGoatRows.indexOf(row);
    row.classList.toggle("hidden", isVendor && !showCorpos || visibleIndex >= MAX_ALL_ROUNDERS_VISIBLE);
  });

}

/** The page's content. paths maps catalog skill IDs to their static pages. */
export function renderLeaderboards(viewData, paths = {}) {
  if (!Array.isArray(viewData?.topSkills) || !Array.isArray(viewData.creatorCategories) || !Array.isArray(viewData.allRounders)
      || !Number.isFinite(Date.parse(viewData.generatedAt))) {
    throw new Error("Invalid leaderboard view data");
  }
  const date = new Date(viewData.generatedAt).toISOString().slice(0, 10);
  return `
    <section class="leaderboard-group skills-group">
      <img class="data-logo" src="/data-logo.png" alt="omgdata" width="378" height="223">
      <p class="data-kicker">Follow the latest growing repos and prolific creators every week</p>
      <h1 class="page-section-title">Top Skills this Week</h1>
      <span class="meta">Updated <time datetime="${date}">${date}</time></span>
      ${renderTrendingSkills(viewData.topSkills, paths)}
    </section>
    <section class="leaderboard-group creators-group">
      <h2 class="page-section-title">Top Skill Creators</h2>
      <label class="creator-toggle"><input type="checkbox" id="show-corpos"> Show Corpos</label>
      <section class="trophy-grid">${viewData.creatorCategories.map((category) => renderTrophy(category)).join("")}</section>
    </section>
    ${renderGoats(viewData.allRounders)}
    <div class="footer">Data source: <a href="/data/v2/manifest.json">manifest.json</a> → <code>leaderboardViewData.path</code></div>
  `;
}

/** Hooks up the Show Corpos switch and applies its default (off). */
export function wireLeaderboards(root) {
  root.querySelector("#show-corpos")?.addEventListener("change", (event) => applyFilter(root, event.target.checked));
  applyFilter(root, false);
}
