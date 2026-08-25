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
  legacyCatalogSkillRedirects,
  skillPathForId,
} from "./web-library-skill-urls.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const sharedSocialImageUrl = `${origin}/images/guide/share.png?v=20260822`;
const maxAuthorSkills = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "3", 10);
const sitemapChunkSize = Number.parseInt(process.env.WEB_LIBRARY_SITEMAP_CHUNK_SIZE || "10000", 10);
const minIndexableDescriptionLength = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_DESCRIPTION_LENGTH || "80", 10);
const minIndexableSnippetLength = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_SNIPPET_LENGTH || "300", 10);
const minIndexableStars = Number.parseInt(process.env.WEB_LIBRARY_MIN_INDEXABLE_STARS || "10", 10);
const llmsGoldMaxBytes = Number.parseInt(process.env.WEB_LIBRARY_LLMS_GOLD_MAX_BYTES || String(5 * 1024 * 1024), 10);
if (!Number.isSafeInteger(llmsGoldMaxBytes) || llmsGoldMaxBytes <= 0) {
  throw new Error("WEB_LIBRARY_LLMS_GOLD_MAX_BYTES must be a positive integer");
}

const generatedDirs = ["skills", "profiles", "creators", "library", "collections", "developers"];
const goldBundlePages = [];
const agentWhenToUse = [
  "Use omgskills when you need to find or evaluate trusted skills for Claude Code, Codex, or other coding agents.",
  "Search the public catalog by task, tool, or creator through the read-only MCP endpoint, Markdown mirrors, or JSON manifests; use the macOS app to install or manage skills.",
].join(" ");

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

function markdownMirrorPath(urlPath) {
  assertTrailingSlash(urlPath);
  return `${urlPath}index.md`;
}

function markdownMirrorUrl(urlPath) {
  return `${origin}${markdownMirrorPath(urlPath)}`;
}

function escapeMarkdownText(value) {
  return normalizeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]<>#])/g, "\\$1");
}

function escapeMarkdownUrl(value) {
  return encodeURI(String(value || ""))
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function markdownLink(label, url) {
  return `[${escapeMarkdownText(label)}](${escapeMarkdownUrl(url)})`;
}

function markdownCodeBlock(value, language = "text") {
  const content = String(value || "").replace(/\r\n?/g, "\n").trim();
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function markdownInlineCode(value) {
  const content = String(value || "").replace(/\s+/g, " ").trim();
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(1, longestFence + 1));
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${padding}${content}${padding}${fence}`;
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

function pageShell({
  title,
  description,
  path: urlPath,
  body,
  structuredData,
  ogType = "website",
  ogImage = "",
  ogImageWidth = "",
  ogImageHeight = "",
  ogImageAlt = "",
  twitterCard = "summary",
  indexTier = "indexable",
}) {
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
  <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownMirrorPath(urlPath))}">
  <link rel="alternate" type="application/ai-catalog+json" href="/.well-known/ai-catalog.json">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:site_name" content="omgskills">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ""}
  ${ogImage && ogImageWidth ? `<meta property="og:image:width" content="${escapeHtml(ogImageWidth)}">` : ""}
  ${ogImage && ogImageHeight ? `<meta property="og:image:height" content="${escapeHtml(ogImageHeight)}">` : ""}
  ${ogImage && ogImageAlt ? `<meta property="og:image:alt" content="${escapeHtml(ogImageAlt)}">` : ""}
  <meta name="twitter:card" content="${escapeHtml(twitterCard)}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ""}
  ${ogImage && ogImageAlt ? `<meta name="twitter:image:alt" content="${escapeHtml(ogImageAlt)}">` : ""}
  <style>
    :root { color-scheme: light; --text: #111111; --muted: #6b7280; --line: #e5e7eb; --soft: #f7f7f8; --blue: #007aff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: #ffffff; }
    header, main { max-width: 880px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; }
    a { color: inherit; }
    .brand { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; min-height: 28px; font-size: 18px; line-height: 1; text-decoration: none; }
    .brand:hover { opacity: .72; }
    .cta { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 16px; border-radius: 999px; background: var(--blue); color: #fff; text-decoration: none; font-size: 10px; font-weight: 400; letter-spacing: 0; transition: opacity .15s; }
    .cta:hover { opacity: .82; }
    .brand:focus-visible, .cta:focus-visible { outline: 3px solid rgba(0, 122, 255, .3); outline-offset: 3px; }
    .apple-icon { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 15px; line-height: 1; transform: translateY(-1px); }
    .eyebrow { color: var(--muted); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    h1 { font-size: clamp(34px, 7vw, 64px); line-height: .95; margin: 12px 0 16px; letter-spacing: -0.04em; }
    h2 { font-size: 20px; margin: 0 0 12px; letter-spacing: -0.02em; }
    p { color: var(--muted); line-height: 1.55; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; color: var(--muted); font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 24px; }
    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .section-heading h2, .section-heading .eyebrow { margin: 0; }
    .view-toggle { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
    .view-toggle:hover { color: var(--text); background: var(--soft); }
    .view-toggle:focus-visible { outline: 3px solid rgba(0, 122, 255, .3); outline-offset: 2px; }
    .view-toggle [hidden] { display: none; }
    .view-icon { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .skill-grid { margin-top: 0; }
    .skill-grid[data-view="list"] { grid-template-columns: 1fr; gap: 8px; }
    .card.skill-card { border: 0; }
    .skill-card-author { display: inline-flex; align-items: center; gap: 5px; }
    .skill-card-author-avatar { width: 18px; height: 18px; overflow: hidden; flex: none; border-radius: 50%; background: var(--soft); }
    .skill-card-author-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .skill-card-stars { display: inline-flex; align-items: center; gap: 4px; }
    .skill-card-star-icon { width: 14px; height: 14px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .skill-detail-title { font-size: clamp(28px, 5vw, 42px); }
    .skill-detail-author, .skill-detail-stars { display: inline-flex; align-items: center; gap: 5px; }
    .skill-detail-author { color: var(--blue); }
    .skill-detail-author-avatar { width: 18px; height: 18px; overflow: hidden; flex: none; border-radius: 50%; background: var(--soft); }
    .skill-detail-author-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .skill-detail > .section > h2, .skill-detail > .skill-section .section-heading h2 { color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .skill-detail > .section:not(.skill-section) > p { font-size: 13px; }
    .skill-grid[data-view="list"] .skill-card { display: grid; grid-template-columns: minmax(140px, 170px) minmax(110px, 128px) minmax(0, 1fr) max-content; align-items: center; gap: 12px; padding: 13px 16px; }
    .skill-grid[data-view="list"] .skill-card-heading { display: contents; }
    .skill-grid[data-view="list"] .skill-card h2 { overflow: hidden; grid-column: 1; grid-row: 1; min-width: 0; margin: 0; text-overflow: ellipsis; white-space: nowrap; }
    .skill-grid[data-view="list"] .skill-card .meta { display: contents; }
    .skill-grid[data-view="list"] .skill-card .meta .skill-card-author { grid-column: 2; grid-row: 1; justify-self: start; color: var(--muted); font-size: 11px; }
    .skill-grid[data-view="list"] .skill-card p { overflow: hidden; grid-column: 3; grid-row: 1; color: #9ca3af; text-overflow: ellipsis; white-space: nowrap; }
    .skill-grid[data-view="list"] .skill-card .meta .skill-card-stars { grid-column: 4; grid-row: 1; justify-self: end; white-space: nowrap; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; margin: 26px 0 4px; }
    .stat { border: 0; border-radius: 10px; padding: 12px; background: var(--soft); }
    .stat strong { display: block; font-size: 22px; letter-spacing: -0.03em; }
    .stat-best-skill { container-type: inline-size; }
    .stat-best-skill strong { overflow: hidden; font-size: clamp(10px, 8cqi, 22px); text-overflow: ellipsis; white-space: nowrap; }
    .stat span { display: block; margin-top: 3px; color: var(--muted); font-size: 13px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
    .badge { border: 1px solid var(--line); border-radius: 999px; padding: 7px 10px; font-size: 13px; color: #3f3f46; background: #fff; }
    .card { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 16px; text-decoration: none; background: #fff; }
    .card:hover { background: var(--soft); }
    .card h2 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.02em; }
    .card p { margin: 0; font-size: 14px; }
    .directory-card-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .directory-card { border: 0; }
    .directory-card-heading h2 { margin: 0; font-size: 13px; }
    .directory-card-image { position: relative; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: none; width: 32px; height: 32px; border-radius: 8px; background: var(--soft); font-size: 14px; }
    .directory-card-image img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .directory-card p, .directory-card .meta { font-size: 11px; }
    .directory-card .directory-card-subtitle { color: var(--text); font-weight: 600; }
    .directory-card .directory-card-description { margin-top: 5px; }
    .skill-section .section-heading h2, .directory-recommendations .eyebrow { color: var(--text); font-size: 13px; font-weight: 400; letter-spacing: 0; text-transform: uppercase; }
    .skill-card h2 { font-size: 13px; }
    .skill-card p { font-size: 11px; }
    .skill-card .meta { font-size: 11px; }
    .avatar { width: 72px; height: 72px; border-radius: 14px; vertical-align: middle; background: var(--soft); }
    .entity-hero { display: grid; grid-template-columns: 100px minmax(0, 1fr); align-items: center; gap: 24px; }
    .entity-avatar { width: 100px; height: 100px; border-radius: 18px; object-fit: cover; }
    .entity-avatar-fallback { display: flex; align-items: center; justify-content: center; font-size: 36px; }
    .entity-title-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px 30px; margin-bottom: 14px; }
    .entity-copy h1 { margin: 0; font-size: clamp(28px, 5vw, 42px); }
    .entity-social-links { display: inline-flex; align-items: center; gap: 8px; }
    .entity-social-link { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; color: #a8adb8; }
    .entity-social-link:hover { color: var(--text); }
    .entity-social-link:focus-visible { border-radius: 3px; outline: 3px solid rgba(0, 122, 255, .3); outline-offset: 2px; }
    .entity-social-link svg { display: block; width: 18px; height: 18px; }
    .entity-copy p { max-width: 68ch; margin: 0; font-size: 13px; }
    .entity-copy .entity-subtitle { margin-bottom: 5px; color: var(--text); font-weight: 600; }
    .install-box { display: flex; align-items: center; gap: 12px; overflow: hidden; border: 0; border-radius: 8px; padding: 6px 8px 6px 14px; background: var(--soft); }
    .copy { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 30px; height: 30px; border: 0; padding: 0; background: transparent; color: var(--blue); cursor: pointer; }
    .copy:hover { color: var(--text); }
    .copy:focus-visible { outline: 3px solid rgba(0, 122, 255, .3); outline-offset: 2px; }
    .copy-icon { width: 15px; height: 15px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .copy-icon[hidden] { display: none; }
    .install { overflow: auto; flex: 1; min-width: 0; margin: 0; padding: 0; background: transparent; font-size: 13px; scrollbar-width: none; }
    .install::-webkit-scrollbar { display: none; }
    .developer-config { overflow: auto; max-width: 100%; border-radius: 8px; margin: 12px 0 0; padding: 14px; background: var(--soft); font-size: 12px; line-height: 1.5; }
    .about { max-width: 72ch; }
    .section { margin-top: 36px; }
    .directory-recommendations { margin-top: 66px; }
    .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    .tag { border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; color: var(--muted); font-size: 13px; }
    .lede { max-width: 68ch; font-size: 17px; }
    @media (max-width: 620px) {
      .entity-hero { grid-template-columns: 72px minmax(0, 1fr); align-items: start; gap: 16px; }
      .entity-avatar { width: 72px; height: 72px; border-radius: 14px; }
      .entity-avatar-fallback { font-size: 24px; }
      .entity-title-row { margin-bottom: 10px; }
      .skill-grid[data-view="list"] .skill-card { grid-template-columns: minmax(0, 1fr) 112px max-content; gap: 6px 12px; }
      .skill-grid[data-view="list"] .skill-card h2 { grid-column: 1; grid-row: 1; }
      .skill-grid[data-view="list"] .skill-card .meta .skill-card-author { grid-column: 2; grid-row: 1; }
      .skill-grid[data-view="list"] .skill-card p { grid-column: 1 / -1; grid-row: 2; }
      .skill-grid[data-view="list"] .skill-card .meta .skill-card-stars { grid-column: 3; grid-row: 1; }
    }
  </style>
  ${structuredDataItems.map((item) => `<script type="application/ld+json">${jsonScript(item)}</script>`).join("\n  ")}
</head>
<body>
  <header>
    <a class="brand" href="/skills/" aria-label="omgskills skills library"><span aria-hidden="true">&#128064;</span></a>
    <a class="cta" href="/downloads/omgskills-mac.dmg"><span class="apple-icon" aria-hidden="true">&#63743;</span>Download for macOS</a>
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
        const copyIcon = button.querySelector("[data-copy-icon]");
        const copiedIcon = button.querySelector("[data-copied-icon]");
        if (copyIcon) copyIcon.hidden = true;
        if (copiedIcon) copiedIcon.hidden = false;
        button.setAttribute("aria-label", "Copied");
        button.setAttribute("title", "Copied");
        window.setTimeout(() => {
          if (copyIcon) copyIcon.hidden = false;
          if (copiedIcon) copiedIcon.hidden = true;
          button.setAttribute("aria-label", "Copy install command");
          button.setAttribute("title", "Copy install command");
        }, 1200);
      });
    });

    const skillViewStorageKey = "omgskills-skill-view";
    const validSkillViews = new Set(["grid", "list"]);
    const applySkillView = (view, persist = false) => {
      const nextView = validSkillViews.has(view) ? view : "grid";
      document.querySelectorAll("[data-skill-grid]").forEach((grid) => {
        grid.dataset.view = nextView;
      });
      document.querySelectorAll("[data-skill-view-toggle]").forEach((button) => {
        const targetView = nextView === "grid" ? "list" : "grid";
        button.dataset.nextView = targetView;
        button.setAttribute("aria-label", "Switch to " + targetView + " view");
        button.setAttribute("title", "Switch to " + targetView + " view");
        button.querySelectorAll("[data-skill-view-icon]").forEach((icon) => {
          icon.hidden = icon.dataset.skillViewIcon !== targetView;
        });
      });
      if (persist) {
        try { window.localStorage.setItem(skillViewStorageKey, nextView); } catch {}
      }
    };
    let savedSkillView = "grid";
    try { savedSkillView = window.localStorage.getItem(skillViewStorageKey) || "grid"; } catch {}
    applySkillView(savedSkillView);
    document.querySelectorAll("[data-skill-view-toggle]").forEach((button) => {
      button.addEventListener("click", () => applySkillView(button.dataset.nextView, true));
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

async function writeGeneratedPage(urlPath, { html, markdown, includeInGoldBundle = false }) {
  const directory = path.join(siteDir, urlPath.replace(/^\/+/, ""));
  const markdownOutput = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "index.html"), html),
    writeFile(path.join(directory, "index.md"), markdownOutput),
  ]);
  if (includeInGoldBundle) {
    goldBundlePages.push({ urlPath, markdown: markdownOutput });
  }
}

async function writeWebLibraryRedirects(profileCollections, generatedSkillUrlById) {
  const lines = [
    "# generated web-library legacy profile redirects",
    "/library/:handle  /library/:handle/  301",
  ];
  for (const redirect of legacyCatalogSkillRedirects) {
    const targetPath = generatedSkillUrlById.get(redirect.catalogSkillId);
    if (!targetPath) {
      throw new Error(
        `Cannot preserve legacy skill URL ${redirect.path}: ${redirect.catalogSkillId} was not generated`,
      );
    }
    lines.push(`${redirect.path}  ${targetPath}  301`);
  }
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
    const starCount = compactNumber(skill.stars);
    const author = skill.author_handle;
    const authorMarkup = author
      ? `<span class="skill-card-author"><span class="skill-card-author-avatar" aria-hidden="true"><img src="${escapeHtml(githubAvatarUrl(author))}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'"></span>@${escapeHtml(author)}</span>`
      : "";
    return `<a class="card skill-card" href="${escapeHtml(href)}">
      <div class="skill-card-heading">
        <h2>${escapeHtml(skill.name)}</h2>
      </div>
      <p>${escapeHtml(subtitleForSkill(skill))}</p>
      <div class="meta">${authorMarkup}<span class="skill-card-stars" aria-label="${escapeHtml(`${starCount} stars`)}"><span aria-hidden="true">${escapeHtml(starCount)}</span>${skillStarIcon()}</span></div>
    </a>`;
  }).join("\n");
}

function skillStarIcon() {
  return `<svg class="skill-card-star-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

function skillViewIcon(view) {
  if (view === "list") {
    return `<svg class="view-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
  }
  return `<svg class="view-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
}

function skillSection(title, skills, skillUrlById, { eyebrow = false } = {}) {
  const heading = eyebrow
    ? `<h2 class="eyebrow">${escapeHtml(title)}</h2>`
    : pageHeading(title);
  return `<div class="section skill-section" data-skill-section>
      <div class="section-heading">
        ${heading}
        <button class="view-toggle" type="button" data-skill-view-toggle data-next-view="list" aria-label="Switch to list view" title="Switch to list view">
          <span data-skill-view-icon="list">${skillViewIcon("list")}</span>
          <span data-skill-view-icon="grid" hidden>${skillViewIcon("grid")}</span>
        </button>
      </div>
      <div class="grid skill-grid" data-skill-grid data-view="grid">${skillCards(skills, skillUrlById)}</div>
    </div>`;
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

const entitySocialIcons = {
  github: `<svg aria-hidden="true" viewBox="0 0 32 32"><path fill="currentColor" d="M26.0387 9.46002C26.3444 8.47401 26.4425 7.43537 26.3267 6.40958C26.211 5.3838 25.8839 4.39312 25.3662 3.50002C25.2785 3.34796 25.1522 3.22171 25.0001 3.13393C24.8481 3.04616 24.6756 2.99998 24.5 3.00002C23.3352 2.99758 22.186 3.2676 21.1442 3.7885C20.1024 4.3094 19.1969 5.06674 18.5 6.00002H15.5C14.8031 5.06674 13.8976 4.3094 12.8558 3.7885C11.814 3.2676 10.6648 2.99758 9.5 3.00002C9.32443 2.99998 9.15193 3.04616 8.99987 3.13393C8.84781 3.22171 8.72154 3.34796 8.63375 3.50002C8.11606 4.39312 7.78903 5.3838 7.67329 6.40958C7.55754 7.43537 7.65559 8.47401 7.96125 9.46002C7.34341 10.5384 7.01245 11.7572 7 13V14C7.0021 15.692 7.61634 17.3261 8.72928 18.6006C9.84222 19.875 11.3787 20.7038 13.055 20.9338C12.3708 21.8093 11.9994 22.8888 12 24V25H9C8.20435 25 7.44129 24.6839 6.87868 24.1213C6.31607 23.5587 6 22.7957 6 22C6 21.3434 5.87067 20.6932 5.6194 20.0866C5.36812 19.48 4.99983 18.9288 4.53553 18.4645C4.07124 18.0002 3.52005 17.6319 2.91342 17.3806C2.30679 17.1293 1.65661 17 1 17C0.734784 17 0.48043 17.1054 0.292893 17.2929C0.105357 17.4804 0 17.7348 0 18C0 18.2652 0.105357 18.5196 0.292893 18.7071C0.48043 18.8947 0.734784 19 1 19C1.79565 19 2.55871 19.3161 3.12132 19.8787C3.68393 20.4413 4 21.2044 4 22C4 23.3261 4.52678 24.5979 5.46447 25.5356C6.40215 26.4732 7.67392 27 9 27H12V29C12 29.2652 12.1054 29.5196 12.2929 29.7071C12.4804 29.8947 12.7348 30 13 30C13.2652 30 13.5196 29.8947 13.7071 29.7071C13.8946 29.5196 14 29.2652 14 29V24C14 23.2044 14.3161 22.4413 14.8787 21.8787C15.4413 21.3161 16.2044 21 17 21C17.7956 21 18.5587 21.3161 19.1213 21.8787C19.6839 22.4413 20 23.2044 20 24V29C20 29.2652 20.1054 29.5196 20.2929 29.7071C20.4804 29.8947 20.7348 30 21 30C21.2652 30 21.5196 29.8947 21.7071 29.7071C21.8946 29.5196 22 29.2652 22 29V24C22.0006 22.8888 21.6292 21.8093 20.945 20.9338C22.6213 20.7038 24.1578 19.875 25.2707 18.6006C26.3837 17.3261 26.9979 15.692 27 14V13C26.9875 11.7572 26.6566 10.5384 26.0387 9.46002ZM25 14C25 15.3261 24.4732 16.5979 23.5355 17.5356C22.5979 18.4732 21.3261 19 20 19H14C12.6739 19 11.4021 18.4732 10.4645 17.5356C9.52678 16.5979 9 15.3261 9 14V13C9.01226 12 9.31164 11.0247 9.8625 10.19C9.96519 10.0547 10.0317 9.89538 10.0558 9.7272C10.0798 9.55902 10.0606 9.38748 10 9.22877C9.73953 8.55701 9.61417 7.84046 9.63112 7.12018C9.64806 6.39989 9.80698 5.69003 10.0988 5.03127C10.9171 5.11931 11.7052 5.39041 12.4046 5.82448C13.104 6.25855 13.6966 6.84446 14.1388 7.53877C14.2288 7.67965 14.3528 7.79569 14.4994 7.87627C14.6459 7.95685 14.8103 7.99939 14.9775 8.00002H19.0212C19.1891 8.00002 19.3543 7.95777 19.5015 7.87716C19.6487 7.79656 19.7733 7.68018 19.8638 7.53877C20.3058 6.84439 20.8985 6.25844 21.5978 5.82436C22.2972 5.39029 23.0853 5.11922 23.9037 5.03127C24.1951 5.69019 24.3536 6.40014 24.3701 7.12043C24.3866 7.84071 24.2609 8.55718 24 9.22877C23.9396 9.38596 23.9193 9.55576 23.9412 9.72275C23.963 9.88974 24.0262 10.0486 24.125 10.185C24.6813 11.0197 24.9851 11.9971 25 13V14Z"></path><path fill="#fff" d="M25 14C25 15.3261 24.4732 16.5979 23.5355 17.5356C22.5979 18.4732 21.3261 19 20 19H14C12.6739 19 11.4021 18.4732 10.4645 17.5356C9.52678 16.5979 9 15.3261 9 14V13C9.01226 12 9.31164 11.0247 9.8625 10.19C9.96519 10.0547 10.0317 9.89538 10.0558 9.7272C10.0798 9.55902 10.0606 9.38748 10 9.22877C9.73953 8.55701 9.61417 7.84046 9.63112 7.12018C9.64806 6.39989 9.80698 5.69003 10.0988 5.03127C10.9171 5.11931 11.7052 5.39041 12.4046 5.82448C13.104 6.25855 13.6966 6.84446 14.1388 7.53877C14.2288 7.67965 14.3528 7.79569 14.4994 7.87627C14.6459 7.95685 14.8103 7.99939 14.9775 8.00002H19.0212C19.1891 8.00002 19.3543 7.95777 19.5015 7.87716C19.6487 7.79656 19.7733 7.68018 19.8638 7.53877C20.3058 6.84439 20.8985 6.25844 21.5978 5.82436C22.2972 5.39029 23.0853 5.11922 23.9037 5.03127C24.1951 5.69019 24.3536 6.40014 24.3701 7.12043C24.3866 7.84071 24.2609 8.55718 24 9.22877C23.9396 9.38596 23.9193 9.55576 23.9412 9.72275C23.963 9.88974 24.0262 10.0486 24.125 10.185C24.6813 11.0197 24.9851 11.9971 25 13V14Z"></path></svg>`,
  x: `<svg aria-hidden="true" viewBox="0 0 32 32"><path fill="currentColor" d="M26.8438 26.4638L19.0188 14.1663L26.74 5.6725C26.9146 5.47565 27.0046 5.21791 26.9905 4.95515C26.9764 4.69239 26.8592 4.44579 26.6645 4.26882C26.4698 4.09185 26.2131 3.99876 25.9502 4.00974C25.6873 4.02073 25.4393 4.1349 25.26 4.3275L17.905 12.4175L12.8438 4.46375C12.7535 4.32169 12.6289 4.20471 12.4814 4.12365C12.3339 4.04258 12.1683 4.00005 12 4H6.00001C5.82071 3.99991 5.64468 4.04803 5.49037 4.13932C5.33605 4.23062 5.20911 4.36172 5.12285 4.5189C5.03659 4.67609 4.99418 4.85357 5.00006 5.03278C5.00593 5.21198 5.05988 5.3863 5.15626 5.5375L12.9813 17.8337L5.26001 26.3337C5.16984 26.4306 5.09979 26.5444 5.05393 26.6685C5.00806 26.7927 4.98729 26.9247 4.99282 27.0569C4.99834 27.1891 5.03005 27.3189 5.08611 27.4388C5.14217 27.5586 5.22146 27.6662 5.3194 27.7552C5.41733 27.8442 5.53195 27.9129 5.65662 27.9572C5.78129 28.0016 5.91352 28.0208 6.04566 28.0137C6.1778 28.0066 6.30722 27.9733 6.42641 27.9158C6.5456 27.8583 6.65219 27.7777 6.74001 27.6787L14.095 19.5888L19.1563 27.5425C19.2472 27.6834 19.3722 27.7991 19.5197 27.8791C19.6671 27.959 19.8323 28.0006 20 28H26C26.1791 27.9999 26.3549 27.9518 26.509 27.8606C26.6632 27.7693 26.79 27.6384 26.8762 27.4814C26.9624 27.3244 27.0049 27.1472 26.9992 26.9681C26.9935 26.7891 26.9398 26.6149 26.8438 26.4638ZM20.5488 26L7.82126 6H11.4463L24.1788 26H20.5488Z"></path><path fill="#fff" d="M20.5488 26L7.82126 6H11.4463L24.1788 26H20.5488Z"></path></svg>`,
};

function entitySocialLink({ href, label, icon, className = "" }) {
  const svg = entitySocialIcons[icon];
  if (!href || !svg) return "";
  return `<a class="entity-social-link${className ? ` ${escapeHtml(className)}` : ""}" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}" target="_blank" rel="noopener noreferrer">${svg}</a>`;
}

function entityHero({ title, subtitle = "", description, imageUrl = "", imageAlt, links = [] }) {
  const image = imageUrl
    ? `<img class="avatar entity-avatar" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}">`
    : `<div class="avatar entity-avatar entity-avatar-fallback" role="img" aria-label="${escapeHtml(imageAlt)}"><span aria-hidden="true">&#128064;</span></div>`;
  const socialLinks = links.map(entitySocialLink).filter(Boolean).join("");
  return `<div class="entity-hero">
      ${image}
      <div class="entity-copy">
        <div class="entity-title-row">
          <h1>${escapeHtml(title)}</h1>
          ${socialLinks ? `<span class="entity-social-links">${socialLinks}</span>` : ""}
        </div>
        ${subtitle ? `<p class="entity-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        <p>${escapeHtml(description)}</p>
      </div>
    </div>`;
}

function directoryCardHeading({ title, imageUrl = "", imageAlt }) {
  return `<div class="directory-card-heading">
      <span class="directory-card-image"><span aria-hidden="true">&#128064;</span>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ""}</span>
      <h2>${escapeHtml(title)}</h2>
    </div>`;
}

function directoryCard(collection, { recommendation = false } = {}) {
  const isProfile = collection.type === "author" && collection.authorHandle;
  const href = isProfile ? profilePath(collection.authorHandle) : collectionPath(collection.id);
  const imageUrl = isProfile
    ? collection.imageUrl || githubAvatarUrl(collection.authorHandle)
    : collection.imageUrl;
  const imageAlt = `${collection.title} ${isProfile ? "profile" : "collection"} image`;
  const subtitle = collection.subtitle || (isProfile ? `Skills by ${collection.title}` : "Editorial collection");
  const description = collection.description && collection.description !== collection.subtitle
    ? `<p class="directory-card-description">${escapeHtml(collection.description)}</p>`
    : "";
  const skillCount = isProfile
    ? ""
    : `<div class="meta"><span>${(collection.skillIds || collection.featuredSkillIds || []).length} skills</span></div>`;

  return `<a class="card directory-card"${recommendation ? " data-recommendation-card" : ""} href="${escapeHtml(href)}">
      ${directoryCardHeading({ title: collection.title, imageUrl, imageAlt })}
      <p class="directory-card-subtitle">${escapeHtml(subtitle)}</p>
      ${description}
      ${skillCount}
    </a>`;
}

function nextAlphabeticalCollections(currentCollection, collections, limit = 3) {
  const sorted = [...collections].sort((a, b) =>
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  if (sorted.length < 2) return [];
  const currentIndex = sorted.findIndex((collection) => collection.id === currentCollection.id);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;
  const recommendations = [];
  for (let offset = 1; offset < sorted.length && recommendations.length < limit; offset += 1) {
    const candidate = sorted[(startIndex + offset + sorted.length) % sorted.length];
    if (candidate.id !== currentCollection.id) recommendations.push(candidate);
  }
  return recommendations;
}

function recommendationSection(collections) {
  if (!collections.length) return "";
  return `<div class="section directory-recommendations">
      <div class="eyebrow">Others you might like</div>
      <div class="grid">${collections.map((collection) => directoryCard(collection, { recommendation: true })).join("")}</div>
    </div>`;
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
    stats.bestSkill?.name ? ["Best skill", stats.bestSkill.name, " stat-best-skill"] : null,
  ].filter(Boolean);
  const badges = Object.entries(authorStats.leaderboardCategories || {}).slice(0, 3);

  return `    <div class="stats">${cells.map(([label, value, className = ""]) => `<div class="stat${className}"><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
    ${badges.length ? `<div class="badges">${badges.map(([name, badge]) => `<span class="badge">#${escapeHtml(badge.rank)} ${escapeHtml(name)} - ${escapeHtml(badge.value)}</span>`).join("")}</div>` : ""}`;
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
  const body = `    <div class="skill-detail">
    <div class="eyebrow">Skill</div>
    <h1 class="skill-detail-title">${escapeHtml(skill.name)}</h1>
    <div class="meta">
      ${author ? `<a class="skill-detail-author" href="${escapeHtml(author.profilePath ?? author.githubUrl)}"><span class="skill-detail-author-avatar" aria-hidden="true"><img src="${escapeHtml(githubAvatarUrl(author.handle))}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'"></span>@${escapeHtml(skill.author_handle)}</a>` : ""}
      <span class="skill-detail-stars" aria-label="${escapeHtml(`${compactNumber(skill.stars)} stars`)}"><span aria-hidden="true">${compactNumber(skill.stars)}</span>${skillStarIcon()}</span>
      ${installsBadge(skill)}
      ${trendingBadge(skill)}
      ${skill.last_updated ? `<span>Updated ${escapeHtml(String(skill.last_updated).slice(0, 10))}</span>` : ""}
      ${skill.github_url ? entitySocialLink({ href: skill.github_url, label: `View ${skill.name} on GitHub`, icon: "github", className: "skill-detail-github-link" }) : ""}
    </div>
    ${visibleDescription ? `<p class="lede">${escapeHtml(visibleDescription)}</p>` : ""}
    ${tagsForSkill(skill)}
    <div class="section">
      ${pageHeading("Install")}
      <div class="install-box">
      <pre class="install"><code id="${escapeHtml(installId)}">${escapeHtml(skill.install_cmd || "")}</code></pre>
      <button class="copy" type="button" data-copy="${escapeHtml(installId)}" aria-label="Copy install command" title="Copy install command"><svg class="copy-icon" data-copy-icon viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="copy-icon" data-copied-icon viewBox="0 0 24 24" aria-hidden="true" hidden><path d="m20 6-11 11-5-5"/></svg></button>
      </div>
    </div>
    ${readmeSnippet ? `<div class="section about">${pageHeading("From README")}<p>${escapeHtml(readmeSnippet)}</p></div>` : ""}
    ${repoSkills.length ? skillSection("More from this repo", repoSkills, skillUrlById) : ""}
    ${authorSkills.length ? skillSection("More skills", authorSkills, skillUrlById) : ""}
    </div>`;
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

function renderProfilePage(collection, skills, skillUrlById, authorStats, recommendations = [], indexTier = "indexable") {
  const handle = collection.authorHandle;
  const urlPath = profilePath(handle);
  const description = profileMetaDescription(collection, skills.length);
  const avatarUrl = collection.imageUrl || githubAvatarUrl(handle);
  const githubUrl = collection.githubUrl || githubProfileUrl(handle);
  const socialLinks = [
    { href: githubUrl, label: `${collection.title} on GitHub`, icon: "github" },
    collection.xUrl ? { href: collection.xUrl, label: `${collection.title} on X`, icon: "x" } : null,
  ].filter(Boolean);
  const body = `    ${entityHero({
    title: collection.title,
    subtitle: collection.subtitle,
    description: collection.description || `Skills by @${handle}.`,
    imageUrl: avatarUrl,
    imageAlt: `${collection.title} profile image`,
    links: socialLinks,
  })}
    ${profileStats(authorStats)}
    ${skillSection("Featured skills", skills, skillUrlById)}
    ${recommendationSection(recommendations)}`;
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
      sameAs: [githubUrl, collection.xUrl].filter(Boolean),
    },
    ogImage: avatarUrl,
    indexTier,
  });
}

function renderCollectionPage(collection, featuredSkills, allSkills, skillUrlById, recommendations = [], indexTier = "indexable") {
  const urlPath = collectionPath(collection.id);
  const description = collectionMetaDescription(collection, allSkills.length);
  const body = `    ${entityHero({
    title: collection.title,
    subtitle: collection.subtitle,
    description: collection.description || `${collection.title} skill collection.`,
    imageUrl: collection.imageUrl,
    imageAlt: `${collection.title} collection image`,
  })}
    ${skillSection("Featured skills", featuredSkills, skillUrlById)}
    ${allSkills.length > featuredSkills.length ? skillSection("Full collection", allSkills, skillUrlById) : ""}
    ${recommendationSection(recommendations)}`;
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
  const body = `    <h1>Skills</h1>
    <p>The best &amp; latest skills from the most trusted sources</p>
    <div class="section"><div class="eyebrow">Featured</div><div class="grid">${profileCollections.map((collection) => directoryCard(collection)).join("")}</div></div>
    <div class="section"><div class="eyebrow">Collections</div><div class="grid">${topicCollections.map((collection) => directoryCard(collection)).join("")}</div></div>
    ${skillSection("Skills", skills, skillUrlById, { eyebrow: true })}`;

  return pageShell({
    title: "Skills - omgskills",
    description: "Browse featured profiles, collections, and selected AI agent skills in the omgskills web library.",
    path: "/skills/",
    ogImage: sharedSocialImageUrl,
    ogImageWidth: "1200",
    ogImageHeight: "630",
    ogImageAlt: "omgskills skills library social preview",
    twitterCard: "summary_large_image",
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

function renderDevelopersPage() {
  const body = `    <div class="developer-page">
    <div class="eyebrow">Developer resources</div>
    <h1>omgskills developer resources</h1>
    <p class="lede">Connect agents to the live omgskills catalog, run the MCP server locally, or read the public library data directly.</p>

    <div class="section">
      <div class="eyebrow">When to use omgskills</div>
      <p>${escapeHtml(agentWhenToUse)}</p>
    </div>

    <div class="section">
      <div class="eyebrow">Hosted MCP</div>
      <h2>Connect to the live catalog</h2>
      <p>The hosted server is public, read-only, and requires no authentication. Add this server URL to an MCP client:</p>
      <div class="install-box"><pre class="install"><code>${origin}/mcp</code></pre></div>
      <p>Available tools: <code>search_skills</code>, <code>get_skill</code>, <code>list_trending</code>, <code>list_gold_basket</code>, and <code>list_by_author</code>.</p>
    </div>

    <div class="section">
      <div class="eyebrow">Local MCP</div>
      <h2>Run from npm</h2>
      <p>Use the published package with any client that can launch a local MCP process:</p>
      <div class="install-box"><pre class="install"><code>npx -y omgskills-mcp</code></pre></div>
      <pre class="developer-config"><code>{
  &quot;mcpServers&quot;: {
    &quot;omgskills&quot;: {
      &quot;command&quot;: &quot;npx&quot;,
      &quot;args&quot;: [&quot;-y&quot;, &quot;omgskills-mcp&quot;]
    }
  }
}</code></pre>
    </div>

    <div class="section">
      <div class="eyebrow">Public data</div>
      <h2>Read without MCP</h2>
      <div class="grid">
        <a class="card" href="/agents.md"><h2>Agent guide</h2><p>When to use omgskills and the preferred machine-readable access paths.</p></a>
        <a class="card" href="/data/manifest.json"><h2>Catalog manifest</h2><p>Current public data assets and hashes.</p></a>
        <a class="card" href="/.well-known/ai-catalog.json"><h2>AI catalog</h2><p>ARD discovery manifest for the hosted MCP server.</p></a>
        <a class="card" href="/skills/index.md"><h2>Markdown library</h2><p>Profiles, collections, and selected skill pages.</p></a>
        <a class="card" href="/llms-gold.txt"><h2>Curated export</h2><p>One-file export of the generated Gold library.</p></a>
      </div>
    </div>

    <div class="section">
      <div class="eyebrow">Links</div>
      <div class="grid">
        <a class="card" href="${origin}/mcp/health"><h2>MCP health</h2><p>Live catalog status and loaded skill count.</p></a>
        <a class="card" href="https://www.npmjs.com/package/omgskills-mcp"><h2>npm package</h2><p>Install the local MCP server.</p></a>
        <a class="card" href="https://github.com/jonslimak/omgskills"><h2>Source</h2><p>Repository, documentation, and issue tracking.</p></a>
      </div>
    </div>

    <div class="section">
      <div class="eyebrow">Safety</div>
      <p>The MCP tools only read public catalog data. They do not install skills, write files, run shell commands, or receive private skill content.</p>
    </div>
    </div>`;

  return pageShell({
    title: "omgskills developer resources - MCP, npm, and public data",
    description: "Connect to the read-only omgskills MCP server, run omgskills-mcp from npm, or read the public AI agent skill catalog and Markdown mirrors.",
    path: "/developers/",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "omgskills developer resources",
      description: "MCP, npm, public catalog data, and Markdown resources for agents and developers.",
      url: `${origin}/developers/`,
    },
  });
}

function markdownAuthorLink(skill, profilePathByCreatorHandle) {
  const author = skillAuthorReference(skill, profilePathByCreatorHandle);
  const url = author.profilePath ? markdownMirrorUrl(author.profilePath) : author.githubUrl;
  return markdownLink(`@${author.handle}`, url);
}

function renderMarkdownSkillList(
  skills,
  skillUrlById,
  profilePathByCreatorHandle,
  { ordered = false, includeInstall = false } = {},
) {
  if (!skills.length) return "_No skills available._";
  return skills.map((skill, index) => {
    const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
    const prefix = ordered ? `${index + 1}.` : "-";
    const details = [
      markdownAuthorLink(skill, profilePathByCreatorHandle),
      `${compactNumber(skill.stars)} stars`,
    ];
    const lines = [
      `${prefix} ${markdownLink(skill.name, markdownMirrorUrl(urlPath))} — ${escapeMarkdownText(subtitleForSkill(skill))}`,
      `   - ${details.join(" · ")}`,
    ];
    if (includeInstall && skill.install_cmd) {
      lines.push(`   - Install: ${markdownInlineCode(skill.install_cmd)}`);
    }
    return lines.join("\n");
  }).join("\n");
}

function renderSkillMarkdown(
  skill,
  repoSkills,
  authorSkills,
  skillUrlById,
  profilePathByCreatorHandle,
) {
  const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
  const metadata = [
    `Claude/Codex skill by ${markdownAuthorLink(skill, profilePathByCreatorHandle)}`,
    `${compactNumber(skill.stars)} stars`,
    skill.installs ? `${compactNumber(skill.installs)} installs` : "",
    skill.last_updated ? `Updated ${String(skill.last_updated).slice(0, 10)}` : "",
  ].filter(Boolean).join(" · ");
  const description = visibleDescriptionForSkill(skill);
  const readmeSnippet = readmeSnippetForSkill(skill);
  const tags = Array.isArray(skill.tags) ? skill.tags.filter(Boolean) : [];
  const author = skillAuthorReference(skill, profilePathByCreatorHandle);
  const authorUrl = author.profilePath ? markdownMirrorUrl(author.profilePath) : author.githubUrl;
  const links = [
    `- HTML page: ${origin}${urlPath}`,
    skill.github_url ? `- GitHub: ${skill.github_url}` : "",
    `- Author: ${markdownLink(`@${author.handle}`, authorUrl)}`,
  ].filter(Boolean).join("\n");
  return `# ${escapeMarkdownText(skill.name)}

> ${metadata}

${escapeMarkdownText(description || descriptionForSkill(skill))}
${tags.length ? `\nTags: ${tags.map(escapeMarkdownText).join(", ")}\n` : ""}
${skill.install_cmd ? `## Install\n\n${markdownCodeBlock(skill.install_cmd, "sh")}\n\n` : ""}${readmeSnippet ? `## From README\n\n${escapeMarkdownText(readmeSnippet)}\n\n` : ""}## Links

${links}
${repoSkills.length ? `\n## More from this repo\n\n${renderMarkdownSkillList(repoSkills, skillUrlById, profilePathByCreatorHandle)}\n` : ""}${authorSkills.length ? `\n## More skills by this author\n\n${renderMarkdownSkillList(authorSkills, skillUrlById, profilePathByCreatorHandle)}\n` : ""}`;
}

function renderProfileMarkdown(
  collection,
  skills,
  skillUrlById,
  profilePathByCreatorHandle,
  authorStats,
  recommendations = [],
) {
  const urlPath = profilePath(collection.authorHandle);
  const githubUrl = collection.githubUrl || githubProfileUrl(collection.authorHandle);
  const stats = authorStats?.stats;
  const statLines = stats ? [
    `- Skills: ${compactNumber(stats.skillCount)}`,
    `- Stars: ${compactNumber(stats.totalStars)}`,
    stats.totalInstalls ? `- Installs: ${compactNumber(stats.totalInstalls)}` : "",
    stats.bestSkill?.name ? `- Best skill: ${escapeMarkdownText(stats.bestSkill.name)}` : "",
  ].filter(Boolean).join("\n") : "";
  const links = [
    `- HTML page: ${origin}${urlPath}`,
    `- GitHub: ${githubUrl}`,
    collection.xUrl ? `- X: ${collection.xUrl}` : "",
  ].filter(Boolean).join("\n");
  return `# ${escapeMarkdownText(collection.title)}

${collection.subtitle ? `> ${escapeMarkdownText(collection.subtitle)}\n\n` : ""}${escapeMarkdownText(collection.description || `Skills by @${collection.authorHandle}.`)}

${statLines ? `## Profile stats\n\n${statLines}\n\n` : ""}## Links

${links}

## Featured skills

${renderMarkdownSkillList(skills, skillUrlById, profilePathByCreatorHandle)}
${recommendations.length ? `\n## Others you might like\n\n${recommendations.map((item) => `- ${markdownLink(item.title, markdownMirrorUrl(profilePath(item.authorHandle)))}`).join("\n")}\n` : ""}`;
}

function renderCollectionMarkdown(
  collection,
  featuredSkills,
  allSkills,
  skillUrlById,
  profilePathByCreatorHandle,
  recommendations = [],
) {
  const urlPath = collectionPath(collection.id);
  const featuredIds = new Set(featuredSkills.map((skill) => skill.id));
  const remainingSkills = allSkills.filter((skill) => !featuredIds.has(skill.id));
  return `# ${escapeMarkdownText(collection.title)}

${collection.subtitle ? `> ${escapeMarkdownText(collection.subtitle)}\n\n` : ""}${escapeMarkdownText(collection.description || `${collection.title} skill collection.`)}

## Links

- HTML page: ${origin}${urlPath}

## Featured skills

${renderMarkdownSkillList(featuredSkills, skillUrlById, profilePathByCreatorHandle, { ordered: true, includeInstall: true })}
${remainingSkills.length ? `\n## Full collection\n\n${renderMarkdownSkillList(remainingSkills, skillUrlById, profilePathByCreatorHandle, { ordered: true, includeInstall: true })}\n` : ""}${recommendations.length ? `\n## Others you might like\n\n${recommendations.map((item) => `- ${markdownLink(item.title, markdownMirrorUrl(collectionPath(item.id)))}`).join("\n")}\n` : ""}`;
}

function renderSkillsIndexMarkdown(
  { profileCollections, topicCollections, skills },
  skillUrlById,
  profilePathByCreatorHandle,
) {
  const profiles = profileCollections.map((collection) => {
    const detail = collection.description || collection.subtitle || `Skills by ${collection.title}`;
    return `- ${markdownLink(collection.title, markdownMirrorUrl(profilePath(collection.authorHandle)))} — ${escapeMarkdownText(detail)}`;
  }).join("\n");
  const collections = topicCollections.map((collection) => {
    const detail = collection.description || collection.subtitle || "Editorial skill collection";
    return `- ${markdownLink(collection.title, markdownMirrorUrl(collectionPath(collection.id)))} — ${escapeMarkdownText(detail)}`;
  }).join("\n");
  return `# omgskills web library

> The best and latest skills from the most trusted sources.

## Featured profiles

${profiles || "_No featured profiles available._"}

## Editorial collections

${collections || "_No editorial collections available._"}

## Skills

${renderMarkdownSkillList(skills, skillUrlById, profilePathByCreatorHandle)}

## Links

- HTML page: ${origin}/skills/
`;
}

function renderDevelopersMarkdown() {
  return `# omgskills developer resources

> Connect agents to the live omgskills catalog, run the MCP server locally, or read the public library data directly.

## When to use omgskills

${agentWhenToUse}

## Hosted MCP

- Server URL: ${origin}/mcp
- Health: ${origin}/mcp/health
- Authentication: none
- Access: read-only

Available tools: \`search_skills\`, \`get_skill\`, \`list_trending\`, \`list_gold_basket\`, and \`list_by_author\`.

## Local MCP

${markdownCodeBlock("npx -y omgskills-mcp", "sh")}

${markdownCodeBlock(`{
  "mcpServers": {
    "omgskills": {
      "command": "npx",
      "args": ["-y", "omgskills-mcp"]
    }
  }
}`, "json")}

## Public data

- Agent guide: ${origin}/agents.md
- Agentic Resource Discovery catalog: ${origin}/.well-known/ai-catalog.json
- Catalog manifest: ${origin}/data/manifest.json
- Markdown library: ${origin}/skills/index.md
- Curated Gold export: ${origin}/llms-gold.txt
- Markdown convention: append \`index.md\` to a generated library page URL

## Safety

The MCP tools only read public catalog data. They do not install skills, write files, run shell commands, or receive private skill content.

## Links

- HTML page: ${origin}/developers/
- npm: https://www.npmjs.com/package/omgskills-mcp
- Source: https://github.com/jonslimak/omgskills
`;
}

function renderGuideMarkdown() {
  return `# Skills: The Complete Guide

> The simple guide for Claude Code, Codex, Cursor, and other agent skills.

## What are skills?

Skills are reusable instructions that tell an AI how you want something done.

It is like asking an AI for good dinner ideas versus asking while sharing a recipe book by Anthony Bourdain.

## When to use skills

- To specify taste, design style, or writing voice while avoiding generic work.
- To apply world-class expertise and judgment to a task.
- To encode workflows you repeat and stop re-explaining them.
- To reduce the agent's freedom to cut corners.
- To share and adopt other people's taste, ideas, and workflows.

## Some examples

- Use [swiftui-pro](${origin}/skills/twostraws/swiftui-agent-skill/swiftui-pro/index.md) to create an iOS app signup screen following Apple's best practices.
- Use [grill-me](${origin}/skills/mattpocock/skills/grill-me/index.md) to ask questions until an idea is fully explained.
- Use [ad-creative](${origin}/skills/coreyhaines31/marketingskills/skills/ad-creative/index.md) to generate ad alternatives for an Instagram campaign.

## When not to use skills

- One-off tasks: just prompt the agent.
- Things the model already does well.
- Live data or system access: those are connections, not instructions.

## How to use a skill

Install skills by sharing a GitHub link with your agent or using the omgskills app.

Use them automatically, or type \`/skill-name\` during a chat session with your prompt.

## How to find good skills

Most people host skills on GitHub and share them on X, Twitter, and Reddit. Use [omgskills](${origin}/skills/), [skills.sh](https://skills.sh/), or similar tools to find, read, install, and share them.

## How to make a skill

Ask your agent to help create one.

## But skills are just Markdown files

Yes. Even so, skill use keeps growing. As models improve, skills get more general, but people will still want to specify the outcomes they want.

## Skills vs. plugins vs. MCP

- **Skill:** Teaches the agent how. Markdown instructions.
- **MCP server:** Gives the agent access. A live program exposing tools or data.
- **Plugin:** Packages skills, commands, and configuration for distribution.
- **Subagent:** Delegates work to a separate context.

They compose: a skill can teach an agent how to use an MCP server well.

## Are skills safe?

Mostly, but not all. Skills are instructions, not code, but agents act on instructions. Like other software, it is best to use skills by trusted creators with large user bases, or ones you create yourself or with your team.

## Why skills?

[Watch the explanation on YouTube](https://www.youtube.com/watch?v=XsiiIa6bs9I).

## Are skills free?

Yes. Skills are open-source Markdown files on GitHub. All 49,000+ indexed here are free.

## Links

- HTML guide: ${origin}/guide/
- Browse skills: ${origin}/skills/
- Download omgskills for macOS: ${origin}/downloads/omgskills-mac.dmg
`;
}

function renderAgentsText() {
  return `# omgskills agent discovery

> omgskills is a public catalog and macOS app for discovering, evaluating, installing, and managing AI agent skills.

## When to use omgskills

${agentWhenToUse}

## Preferred access

- Hosted MCP endpoint: ${origin}/mcp
- MCP health: ${origin}/mcp/health
- Authentication: none
- Access: read-only
- Developer resources: ${origin}/developers/index.md
- Markdown library: ${origin}/skills/index.md
- Curated Gold export: ${origin}/llms-gold.txt
- Public catalog manifest: ${origin}/data/manifest.json
- Agentic Resource Discovery catalog: ${origin}/.well-known/ai-catalog.json

## Markdown mirrors

Append \`index.md\` to any generated library page URL.

## Safety

The MCP tools only read public catalog data. They do not install skills, write files, run shell commands, or receive private skill content. Use the macOS app for installation and local skill management.
`;
}

function renderLlmsText(profileCollections, topicCollections, exampleSkill, skillUrlById) {
  const profileLinks = profileCollections.slice(0, 5)
    .map((collection) => `- ${markdownLink(collection.title, markdownMirrorUrl(profilePath(collection.authorHandle)))}`)
    .join("\n");
  const collectionLinks = topicCollections.slice(0, 5)
    .map((collection) => `- ${markdownLink(collection.title, markdownMirrorUrl(collectionPath(collection.id)))}`)
    .join("\n");
  const exampleSkillPath = exampleSkill
    ? skillUrlById.get(exampleSkill.id) || skillPathForId(exampleSkill.id)
    : null;
  return `# omgskills

> omgskills is a Mac app and public web library for discovering, installing, and organizing AI agent skills.

## Start here

- [Skills: The Complete Guide](${origin}/guide/index.md)
- [HTML skills guide](${origin}/guide/)
- [Markdown library index](${origin}/skills/index.md)
- [HTML library index](${origin}/skills/)
- [Curated Gold library export](${origin}/llms-gold.txt)

## For agents & developers

- [Developer resources](${origin}/developers/index.md)
- Agent discovery guide: ${origin}/agents.md
- Hosted MCP endpoint: ${origin}/mcp
- MCP health: ${origin}/mcp/health
- npm package: https://www.npmjs.com/package/omgskills-mcp
- Agentic Resource Discovery catalog: ${origin}/.well-known/ai-catalog.json
- Public catalog manifest: ${origin}/data/manifest.json

## When to use omgskills

${agentWhenToUse}

## Markdown mirrors

Every generated library page has a Markdown version. Append \`index.md\` to its canonical page URL.

${exampleSkillPath ? `- [Example skill](${markdownMirrorUrl(exampleSkillPath)})\n` : ""}
## Featured profile mirrors

${profileLinks}

## Editorial collection mirrors

${collectionLinks}

## Data

- [Crawl 4 manifest](${origin}/data/crawl4/manifest.json)
- [v2 manifest](${origin}/data/v2/manifest.json)
`;
}

function renderLlmsGoldText(pages, { goldSkillCount, generatedGoldSkillCount }) {
  const sortedPages = [...pages].sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  const header = `# omgskills - curated Gold library export

> Markdown export of the generated library index, profiles, collections, and published Gold Basket skill mirrors.

- Pages: ${sortedPages.length}
- Gold skills included: ${generatedGoldSkillCount}
- Gold skills without a generated page: ${goldSkillCount - generatedGoldSkillCount}
`;
  const body = sortedPages.map(({ urlPath, markdown }) => `
---

Source: ${origin}${urlPath}

${markdown.trim()}
`).join("\n");
  const output = `${header}${body}`;
  const outputBytes = Buffer.byteLength(output, "utf8");
  if (sortedPages.length === 0) {
    throw new Error("Refusing to write an empty llms-gold.txt export");
  }
  if (outputBytes > llmsGoldMaxBytes) {
    throw new Error(`Refusing to write llms-gold.txt: ${outputBytes} bytes exceeds ${llmsGoldMaxBytes}`);
  }
  return { output, outputBytes, pageCount: sortedPages.length };
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
  const goldBasket = await readJson(path.join(repoRoot, "index", "gold-basket.json"));
  if (!Array.isArray(goldBasket)) {
    throw new Error("index/gold-basket.json must contain an array");
  }
  const goldSkillIds = new Set(goldBasket.map((skill) => String(skill.id || "").trim()).filter(Boolean));
  if (goldSkillIds.size === 0) {
    throw new Error("index/gold-basket.json contained no skill IDs");
  }
  assertStaticProfileHandlesReserved(libraryData.collections.collections, reservedProfileHandles);
  goldBundlePages.length = 0;

  for (const dir of generatedDirs) {
    await rm(path.join(siteDir, dir), { recursive: true, force: true });
  }
  await rm(path.join(siteDir, catalogSkillUrlsFilename), { force: true });
  await rm(path.join(siteDir, "agents.md"), { force: true });
  await rm(path.join(siteDir, "llms.txt"), { force: true });
  await rm(path.join(siteDir, "llms-gold.txt"), { force: true });
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
  for (const redirect of legacyCatalogSkillRedirects) {
    includedSkillIds.add(redirect.catalogSkillId);
  }

  const allUrls = new Map([["/", "home"]]);
  const sitemapUrls = new Map([
    ["/", { source: "home" }],
    ["/about/", { source: "about" }],
    ["/guide/", { source: "guide" }],
  ]);
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
    await writeGeneratedPage(urlPath, {
      html: renderSkillPage(
        skill,
        repoSkills,
        authorSkills,
        skillUrlById,
        profilePathByCreatorHandle,
        indexDecision,
      ),
      markdown: renderSkillMarkdown(
        skill,
        repoSkills,
        authorSkills,
        skillUrlById,
        profilePathByCreatorHandle,
      ),
      includeInGoldBundle: goldSkillIds.has(skill.id),
    });
    generatedSkillUrlById.set(skill.id, urlPath);
  }

  const profileCollections = profilePages.map((page) => page.collection);
  const topicCollections = collections.collections.filter((collection) => collection.type !== "author");
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
    const recommendations = nextAlphabeticalCollections(collection, profileCollections);
    const authorStats = authorStatsByHandle.get(collection.authorHandle.toLowerCase());
    await writeGeneratedPage(urlPath, {
      html: renderProfilePage(
        collection,
        authorSkills,
        skillUrlById,
        authorStats,
        recommendations,
        indexTier,
      ),
      markdown: renderProfileMarkdown(
        collection,
        authorSkills,
        skillUrlById,
        profilePathByCreatorHandle,
        authorStats,
        recommendations,
      ),
      includeInGoldBundle: true,
    });
  }

  for (const collection of collections.collections) {
    if (collection.type === "author") continue;
    const featuredSkills = (collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
    const allSkills = (collection.skillIds || collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
    const urlPath = collectionPath(collection.id);
    const indexTier = allSkills.length ? "indexable" : "noindex";
    registerUrl(allUrls, urlPath, `collection ${collection.id}`);
    allUrls.set(urlPath, { source: `collection ${collection.id}`, indexTier });
    if (indexTier === "indexable") {
      sitemapUrls.set(urlPath, { source: `collection ${collection.id}` });
      indexableCount += 1;
    } else {
      noindexCount += 1;
      addNoindexReason("empty-collection");
    }
    const recommendations = nextAlphabeticalCollections(collection, topicCollections);
    await writeGeneratedPage(urlPath, {
      html: renderCollectionPage(
        collection,
        featuredSkills,
        allSkills,
        skillUrlById,
        recommendations,
        indexTier,
      ),
      markdown: renderCollectionMarkdown(
        collection,
        featuredSkills,
        allSkills,
        skillUrlById,
        profilePathByCreatorHandle,
        recommendations,
      ),
      includeInGoldBundle: true,
    });
  }

  registerUrl(allUrls, "/skills/", "skills index");
  allUrls.set("/skills/", { source: "skills index", indexTier: "indexable" });
  sitemapUrls.set("/skills/", { source: "skills index" });
  indexableCount += 1;
  const skillsIndexData = { profileCollections, topicCollections, skills: includedSkills };
  await writeGeneratedPage("/skills/", {
    html: renderSkillsIndexPage(skillsIndexData, skillUrlById),
    markdown: renderSkillsIndexMarkdown(skillsIndexData, skillUrlById, profilePathByCreatorHandle),
    includeInGoldBundle: true,
  });
  registerUrl(allUrls, "/developers/", "developer resources");
  allUrls.set("/developers/", { source: "developer resources", indexTier: "indexable" });
  sitemapUrls.set("/developers/", { source: "developer resources" });
  indexableCount += 1;
  await writeGeneratedPage("/developers/", {
    html: renderDevelopersPage(),
    markdown: renderDevelopersMarkdown(),
  });
  await writeFile(path.join(siteDir, "guide", "index.md"), renderGuideMarkdown());
  await writeWebLibraryRedirects(profileCollections, generatedSkillUrlById);
  await writeFile(
    path.join(siteDir, catalogSkillUrlsFilename),
    `${JSON.stringify(buildCatalogSkillUrlsAsset(generatedSkillUrlById), null, 2)}\n`,
  );
  const llmsExampleSkill = skillById.get("openai/codex:code-review") || includedSkills[0];
  await writeFile(
    path.join(siteDir, "llms.txt"),
    renderLlmsText(profileCollections, topicCollections, llmsExampleSkill, skillUrlById),
  );
  await writeFile(path.join(siteDir, "agents.md"), renderAgentsText());
  const generatedGoldSkillCount = includedSkills.filter((skill) => goldSkillIds.has(skill.id)).length;
  const llmsGold = renderLlmsGoldText(goldBundlePages, {
    goldSkillCount: goldSkillIds.size,
    generatedGoldSkillCount,
  });
  await writeFile(path.join(siteDir, "llms-gold.txt"), llmsGold.output);

  await writeSitemaps(sitemapUrls);
  const noindexSummary = [...noindexReasons.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(", ") || "none";
  console.log(`Built web library test set: ${allUrls.size - 1} HTML pages and ${allUrls.size - 1} Markdown mirrors (${indexableCount} indexable, ${noindexCount} noindex; noindex reasons: ${noindexSummary})`);
  console.log(`Built llms-gold.txt: ${llmsGold.pageCount} pages, ${generatedGoldSkillCount}/${goldSkillIds.size} Gold skills, ${llmsGold.outputBytes} bytes`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
