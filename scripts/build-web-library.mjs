#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertStaticProfileHandlesReserved,
  buildProfilePathByCreatorHandle,
  loadCreatorHandleOwners,
  loadCreatorHandleReservations,
  normalizedCreatorHandle,
} from "./generate-creator-handle-reservations.mjs";
import {
  buildCatalogSkillUrlsAsset,
  buildSkillUrlMap,
  catalogSkillUrlsFilename,
  skillPathForId,
} from "./web-library-skill-urls.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const maxAuthorSkills = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "3", 10);
const sitemapChunkSize = Number.parseInt(process.env.WEB_LIBRARY_SITEMAP_CHUNK_SIZE || "10000", 10);
const minIndexableDescriptionLength = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_DESCRIPTION_LENGTH || "80", 10);
const minIndexableSnippetLength = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_SNIPPET_LENGTH || "300", 10);
const minIndexableStars = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_STARS || "10", 10);

const generatedDirs = ["skills", "profiles", "creators", "library", "collections"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function slugSegment(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function profilePath(handle) {
  return `/library/${slugSegment(handle)}/`;
}

function legacyProfilePath(handle) {
  return `/profiles/${slugSegment(handle)}/`;
}

function collectionPath(id) {
  return `/collections/${slugSegment(id)}/`;
}

function assertTrailingSlash(urlPath) {
  if (!urlPath.endsWith("/")) {
    throw new Error(`Generated URL must end with a trailing slash: ${urlPath}`);
  }
}

function registerUrl(urls, urlPath, source) {
  assertTrailingSlash(urlPath);
  const previousSource = urls.get(urlPath);
  if (previousSource) {
    const previousLabel = typeof previousSource === "object" ? previousSource.source : previousSource;
    throw new Error(`URL collision for ${urlPath}: ${previousLabel} and ${source}`);
  }
  urls.set(urlPath, source);
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(number);
}

function descriptionForSkill(skill) {
  return skill.description || skill.readme_snippet || skill.readmeSnippet || `Install ${skill.name} from ${skill.author_handle || "the omgskills catalog"}.`;
}

function rawDescriptionForSkill(skill) {
  return skill.description || skill.readme_snippet || skill.readmeSnippet || "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortText(value, maxLength = 120) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  return `${slice.slice(0, Math.max(slice.lastIndexOf(" "), 80)).trim()}...`;
}

function subtitleForSkill(skill) {
  const description = normalizeText(rawDescriptionForSkill(skill));
  if (!description) return shortText(`Used for ${skill.name.replace(/[-_]+/g, " ")}`);

  const firstSentence = description.split(/(?<=[.!?])\s+/)[0] || description;
  const generated = firstSentence
    .replace(/^Use this skill whenever\s+/i, "Used when ")
    .replace(/^Use this skill when\s+/i, "Used when ")
    .replace(/^Use when\s+/i, "Used when ")
    .replace(/^Use this skill to\s+/i, "Used to ")
    .replace(/^Use this skill for\s+/i, "Used for ");
  if (generated !== firstSentence) return shortText(generated);

  const firstWord = firstSentence.match(/^([A-Z][a-z]+)\s+/)?.[1];
  const imperativeVerbs = new Set([
    "Add", "Analyze", "Build", "Check", "Create", "Debug", "Design", "Edit", "Find",
    "Fix", "Generate", "Install", "Manage", "Monitor", "Prepare", "Review", "Run",
    "Search", "Test", "Update", "Write",
  ]);
  if (firstWord && imperativeVerbs.has(firstWord)) {
    return shortText(`Used to ${firstSentence.charAt(0).toLowerCase()}${firstSentence.slice(1)}`);
  }

  return shortText(firstSentence);
}

function aboutForSkill(skill) {
  const snippet = normalizeText(skill.readme_snippet || skill.readmeSnippet);
  return snippet || normalizeText(skill.description);
}

function repoKeyForSkill(skill) {
  return String(skill.publisher_repo || String(skill.id).split(":")[0] || "").toLowerCase();
}

function uniqueSkills(skills) {
  const seen = new Set();
  return skills.filter((skill) => {
    if (seen.has(skill.id)) return false;
    seen.add(skill.id);
    return true;
  });
}

function titleize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pageShell({ title, description, path: urlPath, body, structuredData, ogType = "website", ogImage = "", indexTier = "indexable" }) {
  const canonical = `${origin}${urlPath}`;
  const structuredDataItems = Array.isArray(structuredData) ? structuredData : [structuredData];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${indexTier === "noindex" ? '<meta name="robots" content="noindex,follow">' : ""}
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:site_name" content="omgskills">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ""}
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ""}
  <style>
    :root { color-scheme: light; --text: #111111; --muted: #6b7280; --line: #e5e7eb; --soft: #f7f7f8; --blue: #007aff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: #ffffff; }
    header, main { max-width: 880px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; }
    a { color: inherit; }
    .brand { font-size: 13px; font-weight: 700; text-decoration: none; }
    .cta { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; text-decoration: none; font-size: 13px; }
    .eyebrow { color: var(--muted); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    h1 { font-size: clamp(34px, 7vw, 64px); line-height: .95; margin: 12px 0 16px; letter-spacing: -0.04em; }
    h2 { font-size: 20px; margin: 0 0 12px; letter-spacing: -0.02em; }
    p { color: var(--muted); line-height: 1.55; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; color: var(--muted); font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 24px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; margin: 26px 0 4px; }
    .stat { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: #fff; }
    .stat strong { display: block; font-size: 22px; letter-spacing: -0.03em; }
    .stat span { display: block; margin-top: 3px; color: var(--muted); font-size: 13px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
    .badge { border: 1px solid var(--line); border-radius: 999px; padding: 7px 10px; font-size: 13px; color: #3f3f46; background: #fff; }
    .card { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 16px; text-decoration: none; background: #fff; }
    .card:hover { background: var(--soft); }
    .card h2 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.02em; }
    .card p { margin: 0; font-size: 14px; }
    .avatar { width: 72px; height: 72px; border-radius: 14px; vertical-align: middle; background: var(--soft); }
    .install-box { border: 1px solid var(--line); border-radius: 12px; background: #fff; overflow: hidden; }
    .install-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .install-head span { font-size: 13px; font-weight: 700; }
    .copy { border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; background: #fff; color: var(--blue); font: inherit; font-size: 13px; cursor: pointer; }
    .copy:hover { background: var(--soft); }
    .install { overflow: auto; margin: 0; padding: 14px; background: var(--soft); font-size: 13px; }
    .about { max-width: 72ch; }
    .section { margin-top: 36px; }
    .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .tag { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); font-size: 13px; }
    .lede { max-width: 68ch; font-size: 17px; }
  </style>
  ${structuredDataItems.map((item) => `<script type="application/ld+json">${jsonScript(item)}</script>`).join("\n  ")}
</head>
<body>
  <header>
    <a class="brand" href="/">omgskills</a>
    <a class="cta" href="/">Get the Mac app</a>
  </header>
  <main>
${body}
  </main>
  <script>
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copy);
        if (!target || !navigator.clipboard) return;
        await navigator.clipboard.writeText(target.textContent.trim());
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = "Copy"; }, 1200);
      });
    });
  </script>
</body>
</html>
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readAssetFromManifest(track) {
  const manifestPath = path.join(siteDir, "data", track, "manifest.json");
  const manifest = await readJson(manifestPath);
  const readAsset = async (asset) => readJson(path.join(path.dirname(manifestPath), asset.path));
  return {
    track,
    manifest,
    skills: await readAsset(manifest.skills),
    trending: manifest.trending ? await readAsset(manifest.trending) : [],
    collections: manifest.collections ? await readAsset(manifest.collections) : { collections: [] },
    authorLeaderboards: manifest.authorLeaderboards ? await readAsset(manifest.authorLeaderboards) : [],
  };
}

async function loadLibraryData() {
  let data;
  try {
    data = await readAssetFromManifest("crawl4");
  } catch (error) {
    console.warn(`build-web-library: Crawl 4 unavailable (${error.message}); falling back to v2`);
    data = await readAssetFromManifest("v2");
  }

  if (!data.authorLeaderboards.length) {
    for (const track of ["v2", ""]) {
      try {
        const fallback = track ? await readAssetFromManifest(track) : await readRootManifest();
        if (fallback.authorLeaderboards.length) {
          data.authorLeaderboards = fallback.authorLeaderboards;
          break;
        }
      } catch {
        // Author stats are optional enhancement data.
      }
    }
  }

  return data;
}

async function readRootManifest() {
  const manifestPath = path.join(siteDir, "data", "manifest.json");
  const manifest = await readJson(manifestPath);
  const readAsset = async (asset) => readJson(path.join(path.dirname(manifestPath), asset.path));
  return {
    authorLeaderboards: manifest.authorLeaderboards ? await readAsset(manifest.authorLeaderboards) : [],
  };
}

async function writePage(urlPath, html) {
  const filePath = path.join(siteDir, urlPath.replace(/^\/+/, ""), "index.html");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, html);
}

async function writeWebLibraryRedirects(profileCollections) {
  const lines = [
    "# generated web-library legacy profile redirects",
    "/library/:handle  /library/:handle/  301",
  ];
  for (const collection of profileCollections) {
    if (!collection.authorHandle) continue;
    const from = legacyProfilePath(collection.authorHandle);
    const to = profilePath(collection.authorHandle);
    lines.push(`${from.replace(/\/$/, "")}  ${to}  301`);
    lines.push(`${from}  ${to}  301`);
  }
  lines.push("/profiles/*  /u/:splat  301");
  await writeFile(path.join(siteDir, "_web-library-redirects"), `${lines.join("\n")}\n`);
}

async function removeSitemapFiles() {
  for (const entry of await readdir(siteDir)) {
    if (/^sitemap(?:-\d+)?\.xml$/.test(entry)) {
      await rm(path.join(siteDir, entry), { force: true });
    }
  }
}

function skillCards(skills, skillUrlById) {
  return skills.map((skill) => {
    const href = skillUrlById.get(skill.id) || skillPathForId(skill.id);
    return `<a class="card" href="${escapeHtml(href)}">
      <h2>${escapeHtml(skill.name)}</h2>
      <p>${escapeHtml(subtitleForSkill(skill))}</p>
      <div class="meta"><span>${compactNumber(skill.stars)} stars</span>${skill.author_handle ? `<span>@${escapeHtml(skill.author_handle)}</span>` : ""}</div>
    </a>`;
  }).join("\n");
}

function skillAuthor(skill) {
  return skill.author_handle || skill.publisher_handle || String(skill.id || "").split("/")[0] || "omgskills";
}

function skillTitle(skill) {
  return `${skill.name} \u2014 Claude skill by ${skillAuthor(skill)} | omgskills`;
}

function skillMetaDescription(skill) {
  const author = skillAuthor(skill);
  const base = normalizeText(descriptionForSkill(skill));
  const summary = base ? shortText(base, 95) : `Install and use ${skill.name} with Claude Code or Codex.`;
  return shortText(`${summary} Install ${skill.name}, a Claude and Codex skill by ${author}, from the omgskills library.`, 155);
}

function profileMetaDescription(collection, skillCount) {
  const handle = collection.authorHandle;
  const description = collection.description || collection.subtitle || `Browse Claude and Codex skills by @${handle}.`;
  return shortText(`${description} Explore ${skillCount} featured skills and install them with omgskills.`, 155);
}

function collectionMetaDescription(collection, skillCount) {
  const description = collection.description || collection.subtitle || `${collection.title} is an editorial skill collection.`;
  return shortText(`${description} Browse ${skillCount} Claude and Codex skills in this omgskills collection.`, 155);
}

function pageHeading(title) {
  return `<h2>${escapeHtml(title)}</h2>`;
}

function tagsForSkill(skill) {
  const tags = Array.isArray(skill.tags) ? skill.tags.filter(Boolean).slice(0, 8) : [];
  if (!tags.length) return "";
  return `<div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function visibleDescriptionForSkill(skill) {
  return normalizeText(skill.description);
}

function readmeSnippetForSkill(skill) {
  const snippet = normalizeText(skill.readme_snippet || skill.readmeSnippet);
  const description = visibleDescriptionForSkill(skill);
  if (!snippet || snippet === description) return "";
  return snippet;
}

function indexableContentSignals(skill) {
  const descriptionLength = visibleDescriptionForSkill(skill).length;
  const snippetLength = readmeSnippetForSkill(skill).length;
  return {
    descriptionLength,
    snippetLength,
    hasUsefulContent: descriptionLength >= minIndexableDescriptionLength || snippetLength >= minIndexableSnippetLength,
    hasStrongSnippet: snippetLength >= minIndexableSnippetLength,
  };
}

function skillIndexDecision(skill, { isEditorial = false, isTrending = false } = {}) {
  const signals = indexableContentSignals(skill);
  const hasQualitySignal = isEditorial || isTrending || Number(skill.stars || 0) >= minIndexableStars || signals.hasStrongSnippet;
  if (signals.hasUsefulContent && hasQualitySignal) {
    return { tier: "indexable", reason: "indexable" };
  }

  const missing = [];
  if (!signals.hasUsefulContent) missing.push("thin-content");
  if (!hasQualitySignal) missing.push("low-signal");
  return { tier: "noindex", reason: missing.join("+") || "noindex" };
}

function trendingBadge(skill) {
  if (!skill.trending_rank) return "";
  const source = skill.trending_source ? ` on ${titleize(skill.trending_source)}` : "";
  return `<span>Trending #${escapeHtml(skill.trending_rank)}${escapeHtml(source)}</span>`;
}

function installsBadge(skill) {
  if (!skill.installs) return "";
  return `<span>${compactNumber(skill.installs)} installs</span>`;
}

function githubAvatarUrl(handle) {
  return `https://github.com/${handle}.png`;
}

function githubProfileUrl(handle) {
  return `https://github.com/${encodeURIComponent(String(handle ?? ""))}`;
}

function skillAuthorReference(skill, profilePathByCreatorHandle) {
  const handle = skillAuthor(skill);
  return {
    handle,
    githubUrl: githubProfileUrl(handle),
    profilePath: profilePathByCreatorHandle.get(normalizedCreatorHandle(handle)) ?? null,
  };
}

function profileSchemaType(collection) {
  if (collection.schemaType === "Organization" || collection.entityType === "organization") return "Organization";
  const handle = String(collection.authorHandle || "");
  const title = String(collection.title || "");
  const knownOrganizations = new Set(["openai", "anthropic", "anthropics", "cursor"]);
  if (knownOrganizations.has(handle.toLowerCase())) return "Organization";
  if (title === title.toUpperCase() && title.length > 1) return "Organization";
  return "Person";
}

function skillStructuredData(skill, urlPath, description, profilePathByCreatorHandle) {
  const author = skillAuthorReference(skill, profilePathByCreatorHandle);
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: skill.name,
    description,
    url: `${origin}${urlPath}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS",
    softwareRequirements: "Claude Code or Codex",
    author: {
      "@type": "Organization",
      name: author.handle,
      url: author.profilePath ? `${origin}${author.profilePath}` : author.githubUrl,
      sameAs: author.githubUrl,
    },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  if (skill.last_updated) data.dateModified = String(skill.last_updated);
  return data;
}

function skillBreadcrumbData(skill, urlPath, profilePathByCreatorHandle) {
  const author = skillAuthorReference(skill, profilePathByCreatorHandle);
  const itemListElement = [
    { "@type": "ListItem", position: 1, name: "Skills", item: `${origin}/skills/` },
  ];
  if (author.profilePath) {
    itemListElement.push({
      "@type": "ListItem",
      position: 2,
      name: author.handle,
      item: `${origin}${author.profilePath}`,
    });
  }
  itemListElement.push({
    "@type": "ListItem",
    position: itemListElement.length + 1,
    name: skill.name,
    item: `${origin}${urlPath}`,
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}

function profileStats(authorStats) {
  if (!authorStats?.stats) return "";
  const stats = authorStats.stats;
  const cells = [
    ["Skills", compactNumber(stats.skillCount)],
    ["Stars", compactNumber(stats.totalStars)],
    stats.totalInstalls ? ["Installs", compactNumber(stats.totalInstalls)] : null,
    stats.bestSkill?.name ? ["Best skill", stats.bestSkill.name] : null,
  ].filter(Boolean);
  const badges = Object.entries(authorStats.leaderboardCategories || {}).slice(0, 3);

  return `    <div class="stats">${cells.map(([label, value]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
    ${badges.length ? `<div class="badges">${badges.map(([name, badge]) => `<span class="badge">#${escapeHtml(badge.rank)} ${escapeHtml(name)} - ${escapeHtml(badge.value)}</span>`).join("")}</div>` : ""}`;
}

function authorConfidenceBadge(skill) {
  if (!skill.author_confidence) return "";
  return `<span>Author match: ${escapeHtml(titleize(skill.author_confidence))}</span>`;
}

function renderSkillPage(
  skill,
  repoSkills,
  authorSkills,
  skillUrlById,
  profilePathByCreatorHandle,
  indexDecision,
) {
  const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
  const description = skillMetaDescription(skill);
  const visibleDescription = visibleDescriptionForSkill(skill);
  const readmeSnippet = readmeSnippetForSkill(skill);
  const installId = `install-${createHash("sha256").update(skill.id).digest("hex").slice(0, 10)}`;
  const author = skill.author_handle
    ? skillAuthorReference(skill, profilePathByCreatorHandle)
    : null;
  const body = `    <div class="eyebrow">Skill</div>
    <h1>${escapeHtml(skill.name)}</h1>
    <div class="meta">
      ${author ? `<a href="${escapeHtml(author.profilePath ?? author.githubUrl)}">@${escapeHtml(skill.author_handle)}</a>` : ""}
      <span>${compactNumber(skill.stars)} stars</span>
      ${installsBadge(skill)}
      ${trendingBadge(skill)}
      ${skill.last_updated ? `<span>Updated ${escapeHtml(String(skill.last_updated).slice(0, 10))}</span>` : ""}
      ${authorConfidenceBadge(skill)}
    </div>
    ${visibleDescription ? `<p class="lede">${escapeHtml(visibleDescription)}</p>` : ""}
    ${tagsForSkill(skill)}
    <div class="section">
      ${pageHeading("Install")}
      <p>Install this Claude and Codex skill with the command below. The command stays visible even when copy support is unavailable.</p>
      <div class="install-box">
      <div class="install-head"><span>Install command</span><button class="copy" type="button" data-copy="${escapeHtml(installId)}">Copy</button></div>
      <pre class="install"><code id="${escapeHtml(installId)}">${escapeHtml(skill.install_cmd || "")}</code></pre>
      </div>
    </div>
    ${skill.github_url ? `<p><a href="${escapeHtml(skill.github_url)}">View on GitHub</a></p>` : ""}
    ${readmeSnippet ? `<div class="section about">${pageHeading("From README")}<p>${escapeHtml(readmeSnippet)}</p></div>` : ""}
    ${repoSkills.length ? `<div class="section">${pageHeading("More from this repo")}<div class="grid">${skillCards(repoSkills, skillUrlById)}</div></div>` : ""}
    ${authorSkills.length ? `<div class="section">${pageHeading("More skills")}<div class="grid">${skillCards(authorSkills, skillUrlById)}</div></div>` : ""}`;
  return pageShell({
    title: skillTitle(skill),
    description,
    path: urlPath,
    body,
    structuredData: [
      skillStructuredData(skill, urlPath, description, profilePathByCreatorHandle),
      skillBreadcrumbData(skill, urlPath, profilePathByCreatorHandle),
    ],
    ogType: "article",
    indexTier: indexDecision.tier,
  });
}

function renderProfilePage(collection, skills, skillUrlById, authorStats, indexTier = "indexable") {
  const handle = collection.authorHandle;
  const urlPath = profilePath(handle);
  const description = profileMetaDescription(collection, skills.length);
  const avatarUrl = collection.imageUrl || githubAvatarUrl(handle);
  const body = `    <img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(`${collection.title} profile image`)}">
    <div class="eyebrow">Profile</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(collection.description || collection.subtitle || `Skills by @${handle}.`)}</p>
    <div class="meta"><span>@${escapeHtml(handle)}</span><span>${skills.length} featured skills</span></div>
    ${profileStats(authorStats)}
    <div class="section">${pageHeading("Featured skills")}<div class="grid">${skillCards(skills, skillUrlById)}</div></div>`;
  return pageShell({
    title: `${collection.title}'s Claude & Codex skills (${skills.length}) | omgskills`,
    description,
    path: urlPath,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": profileSchemaType(collection),
      name: collection.title,
      url: `${origin}${urlPath}`,
      image: avatarUrl,
      sameAs: [`https://github.com/${handle}`],
    },
    ogImage: avatarUrl,
    indexTier,
  });
}

function renderCollectionPage(collection, featuredSkills, allSkills, skillUrlById, indexTier = "indexable") {
  const urlPath = collectionPath(collection.id);
  const description = collectionMetaDescription(collection, allSkills.length);
  const body = `    <div class="eyebrow">Collection</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(collection.description || collection.subtitle || `${collection.title} skill collection.`)}</p>
    <div class="meta"><span>${allSkills.length} skills</span></div>
    <div class="section">${pageHeading("Featured skills")}<div class="grid">${skillCards(featuredSkills, skillUrlById)}</div></div>
    ${allSkills.length > featuredSkills.length ? `<div class="section">${pageHeading("Full collection")}<div class="grid">${skillCards(allSkills, skillUrlById)}</div></div>` : ""}`;
  return pageShell({
    title: `${collection.title} \u2014 skill collection | omgskills`,
    description,
    path: urlPath,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: collection.title,
      description,
      url: `${origin}${urlPath}`,
    },
    indexTier,
  });
}

function renderSkillsIndexPage({ profileCollections, topicCollections, skills }, skillUrlById) {
  const body = `    <div class="eyebrow">Library</div>
    <h1>Skills</h1>
    <p>Browse the current omgskills web library test set: featured profiles, editorial collections, and selected skills.</p>
    <div class="section"><div class="eyebrow">Profiles</div><div class="grid">${profileCollections.map((collection) => `<a class="card" href="${escapeHtml(profilePath(collection.authorHandle))}">
      <h2>${escapeHtml(collection.title)}</h2>
      <p>${escapeHtml(collection.subtitle || collection.description || `Skills by @${collection.authorHandle}.`)}</p>
      <div class="meta"><span>@${escapeHtml(collection.authorHandle)}</span></div>
    </a>`).join("")}</div></div>
    <div class="section"><div class="eyebrow">Collections</div><div class="grid">${topicCollections.map((collection) => `<a class="card" href="${escapeHtml(collectionPath(collection.id))}">
      <h2>${escapeHtml(collection.title)}</h2>
      <p>${escapeHtml(collection.subtitle || collection.description || "Editorial collection")}</p>
      <div class="meta"><span>${(collection.skillIds || collection.featuredSkillIds || []).length} skills</span></div>
    </a>`).join("")}</div></div>
    <div class="section"><div class="eyebrow">Skills</div><div class="grid">${skillCards(skills, skillUrlById)}</div></div>`;

  return pageShell({
    title: "Skills - omgskills",
    description: "Browse featured profiles, collections, and selected AI agent skills in the omgskills web library.",
    path: "/skills/",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "omgskills web library",
      description: "Featured profiles, collections, and selected AI agent skills.",
      url: `${origin}/skills/`,
    },
  });
}

function sitemapLastmod(value) {
  if (!value) return "";
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

async function writeSitemaps(urls) {
  const sortedEntries = [...urls.entries()].sort(([a], [b]) => a.localeCompare(b));
  const urlsetForEntries = (entries) => entries
    .map(([urlPath, metadata]) => {
      const lastmod = sitemapLastmod(metadata?.lastmod);
      return `  <url><loc>${escapeHtml(`${origin}${urlPath}`)}</loc>${lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : ""}</url>`;
    })
    .join("\n");

  if (sortedEntries.length <= sitemapChunkSize) {
    const urlset = urlsetForEntries(sortedEntries);
    await writeFile(
      path.join(siteDir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`,
    );
    return;
  }

  const chunks = [];
  for (let index = 0; index < sortedEntries.length; index += sitemapChunkSize) {
    chunks.push(sortedEntries.slice(index, index + sitemapChunkSize));
  }

  await Promise.all(chunks.map((entries, index) => writeFile(
    path.join(siteDir, `sitemap-${index + 1}.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsetForEntries(entries)}\n</urlset>\n`,
  )));

  const indexXml = chunks
    .map((_, index) => `  <sitemap><loc>${escapeHtml(`${origin}/sitemap-${index + 1}.xml`)}</loc></sitemap>`)
    .join("\n");
  await writeFile(
    path.join(siteDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexXml}\n</sitemapindex>\n`,
  );
}

async function main() {
  const reservedProfileHandles = loadCreatorHandleReservations();
  const libraryData = await loadLibraryData();
  assertStaticProfileHandlesReserved(libraryData.collections.collections, reservedProfileHandles);

  for (const dir of generatedDirs) {
    await rm(path.join(siteDir, dir), { recursive: true, force: true });
  }
  await rm(path.join(siteDir, catalogSkillUrlsFilename), { force: true });
  await removeSitemapFiles();

  const { skills, trending, collections, authorLeaderboards } = libraryData;
  const skillUrlById = buildSkillUrlMap(skills);
  const profilePages = collections.collections
    .filter((collection) => collection.type === "author" && collection.authorHandle)
    .map((collection) => ({
      authorHandle: collection.authorHandle,
      collection,
      urlPath: profilePath(collection.authorHandle),
    }));
  const profilePathByCreatorHandle = buildProfilePathByCreatorHandle(
    profilePages,
    loadCreatorHandleOwners(),
  );

  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const trendingById = new Map(trending.map((entry) => [entry.id, entry]));
  const authorStatsByHandle = new Map(authorLeaderboards.map((entry) => [String(entry.authorHandle || "").toLowerCase(), entry]));
  const skillsByAuthor = new Map();
  const skillsByRepo = new Map();
  for (const skill of skills) {
    const handle = String(skill.author_handle || "").toLowerCase();
    if (handle) {
      const authorList = skillsByAuthor.get(handle) || [];
      authorList.push(skill);
      skillsByAuthor.set(handle, authorList);
    }

    const repoKey = repoKeyForSkill(skill);
    if (repoKey) {
      const repoList = skillsByRepo.get(repoKey) || [];
      repoList.push(skill);
      skillsByRepo.set(repoKey, repoList);
    }
  }
  for (const list of [...skillsByAuthor.values(), ...skillsByRepo.values()]) {
    list.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
  }

  const includedSkillIds = new Set();
  const editorialSkillIds = new Set();
  for (const collection of collections.collections) {
    for (const id of collection.featuredSkillIds || []) {
      includedSkillIds.add(id);
      editorialSkillIds.add(id);
    }
    for (const id of collection.skillIds || []) {
      includedSkillIds.add(id);
      editorialSkillIds.add(id);
    }
    if (collection.type === "author" && collection.authorHandle) {
      for (const skill of (skillsByAuthor.get(collection.authorHandle.toLowerCase()) || []).slice(0, maxAuthorSkills)) {
        includedSkillIds.add(skill.id);
      }
    }
  }
  for (const entry of trending.slice(0, 25)) {
    if (entry.id) includedSkillIds.add(entry.id);
  }

  const allUrls = new Map([["/", "home"]]);
  const sitemapUrls = new Map([["/", { source: "home" }]]);
  const noindexReasons = new Map();
  let indexableCount = 0;
  let noindexCount = 0;
  const addNoindexReason = (reason) => noindexReasons.set(reason, (noindexReasons.get(reason) || 0) + 1);
  const includedSkills = [];
  const generatedSkillUrlById = new Map();
  for (const id of includedSkillIds) {
    const skill = skillById.get(id);
    if (!skill) continue;
    Object.assign(skill, trendingById.get(skill.id) || {});
    const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
    const indexDecision = skillIndexDecision(skill, {
      isEditorial: editorialSkillIds.has(skill.id),
      isTrending: trendingById.has(skill.id),
    });
    registerUrl(allUrls, urlPath, `skill ${skill.id}`);
    allUrls.set(urlPath, { source: `skill ${skill.id}`, lastmod: skill.last_updated, indexTier: indexDecision.tier });
    if (indexDecision.tier === "indexable") {
      sitemapUrls.set(urlPath, { source: `skill ${skill.id}`, lastmod: skill.last_updated });
      indexableCount += 1;
    } else {
      noindexCount += 1;
      addNoindexReason(indexDecision.reason);
    }
    includedSkills.push(skill);
    const repoSkills = (skillsByRepo.get(repoKeyForSkill(skill)) || [])
      .filter((candidate) => candidate.id !== skill.id && includedSkillIds.has(candidate.id))
      .slice(0, 3);
    const repoSkillIds = new Set(repoSkills.map((candidate) => candidate.id));
    const authorSkills = uniqueSkills(skillsByAuthor.get(String(skill.author_handle || "").toLowerCase()) || [])
      .filter((candidate) => candidate.id !== skill.id && includedSkillIds.has(candidate.id) && !repoSkillIds.has(candidate.id))
      .slice(0, Math.max(0, 3 - repoSkills.length));
    await writePage(
      urlPath,
      renderSkillPage(
        skill,
        repoSkills,
        authorSkills,
        skillUrlById,
        profilePathByCreatorHandle,
        indexDecision,
      ),
    );
    generatedSkillUrlById.set(skill.id, urlPath);
  }

  const profileCollections = profilePages.map((page) => page.collection);
  const topicCollections = [];
  for (const { collection, urlPath } of profilePages) {
    const authorSkills = (skillsByAuthor.get(collection.authorHandle.toLowerCase()) || [])
      .filter((skill) => includedSkillIds.has(skill.id))
      .slice(0, 12);
    const indexTier = authorSkills.length ? "indexable" : "noindex";
    registerUrl(allUrls, urlPath, `profile ${collection.authorHandle}`);
    allUrls.set(urlPath, { source: `profile ${collection.authorHandle}`, indexTier });
    if (indexTier === "indexable") {
      sitemapUrls.set(urlPath, { source: `profile ${collection.authorHandle}` });
      indexableCount += 1;
    } else {
      noindexCount += 1;
      addNoindexReason("empty-profile");
    }
    await writePage(
      urlPath,
      renderProfilePage(
        collection,
        authorSkills,
        skillUrlById,
        authorStatsByHandle.get(collection.authorHandle.toLowerCase()),
        indexTier,
      ),
    );
  }

  for (const collection of collections.collections) {
    if (collection.type === "author") continue;
    const featuredSkills = (collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
    const allSkills = (collection.skillIds || collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
    const urlPath = collectionPath(collection.id);
    const indexTier = allSkills.length ? "indexable" : "noindex";
    topicCollections.push(collection);
    registerUrl(allUrls, urlPath, `collection ${collection.id}`);
    allUrls.set(urlPath, { source: `collection ${collection.id}`, indexTier });
    if (indexTier === "indexable") {
      sitemapUrls.set(urlPath, { source: `collection ${collection.id}` });
      indexableCount += 1;
    } else {
      noindexCount += 1;
      addNoindexReason("empty-collection");
    }
    await writePage(urlPath, renderCollectionPage(collection, featuredSkills, allSkills, skillUrlById, indexTier));
  }

  registerUrl(allUrls, "/skills/", "skills index");
  allUrls.set("/skills/", { source: "skills index", indexTier: "indexable" });
  sitemapUrls.set("/skills/", { source: "skills index" });
  indexableCount += 1;
  await writePage("/skills/", renderSkillsIndexPage({ profileCollections, topicCollections, skills: includedSkills }, skillUrlById));
  await writeWebLibraryRedirects(profileCollections);
  await writeFile(
    path.join(siteDir, catalogSkillUrlsFilename),
    `${JSON.stringify(buildCatalogSkillUrlsAsset(generatedSkillUrlById), null, 2)}\n`,
  );

  await writeSitemaps(sitemapUrls);
  const noindexSummary = [...noindexReasons.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(", ") || "none";
  console.log(`Built web library test set: ${allUrls.size - 1} pages (${indexableCount} indexable, ${noindexCount} noindex; noindex reasons: ${noindexSummary})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
