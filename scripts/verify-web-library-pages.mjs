#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  catalogSkillUrlEntries,
  catalogSkillUrlsFilename,
  legacyCatalogSkillRedirects,
} from "./web-library-skill-urls.mjs";
import {
  homepageLibraryPaths,
  verifyHomepageLibraryPreview,
} from "./homepage-library-preview.mjs";
import { assertIndexStateMatchesSitemap } from "./web-library-index-verification.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isLive = process.argv.includes("--live");
const liveFetchAttempts = 3;
const livePageHtmlByPath = new Map();
const dynamicLocalPaths = new Set(["/mcp", "/mcp/health"]);

const editorialCollections = JSON.parse(
  await readFile(path.join(repoRoot, "index", "curations", "collections.json"), "utf8"),
);
const starterPack = editorialCollections.collections?.find((collection) => collection.id === "starter-pack");
if (!starterPack?.title) {
  throw new Error("Editorial collections did not contain a titled starter-pack fixture");
}

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchLive(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= liveFetchAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status < 500 || attempt === liveFetchAttempts) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500 * attempt);
  }
  throw new Error(`Failed to fetch ${url} after ${liveFetchAttempts} attempts: ${lastError?.message || lastError}`);
}

const pages = [
  {
    path: "/library/openai/",
    canonical: "https://omgskills.com/library/openai/",
    text: "OpenAI",
    titleText: "OpenAI&#39;s Claude &amp; Codex skills",
    descriptionText: "Codex skills",
    profileMetadata: true,
    recommendations: { currentPath: "/library/openai/" },
    skillLayout: true,
    markdownText: "# OpenAI",
  },
  {
    path: "/library/mattpocock/",
    canonical: "https://omgskills.com/library/mattpocock/",
    text: "Matt Pocock",
    profileSocialLinks: {
      github: "https://github.com/mattpocock",
      x: "https://x.com/mattpocockuk",
    },
    markdownText: "# Matt Pocock",
  },
  {
    path: "/collections/starter-pack/",
    canonical: "https://omgskills.com/collections/starter-pack/",
    text: escapeHtml(starterPack.title),
    titleText: escapeHtml(starterPack.title),
    descriptionText: "Claude and Codex",
    collectionMetadata: true,
    collectionSubtitle: starterPack.subtitle,
    collectionDescription: starterPack.description,
    collectionSkillCount: (starterPack.skillIds || starterPack.featuredSkillIds || []).length,
    recommendations: { currentPath: "/collections/starter-pack/" },
    skillLayout: true,
    markdownText: `# ${starterPack.title}`,
  },
  {
    path: "/skills/openai/codex/code-review/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review/",
    text: "code-review",
    titleText: "Claude skill by openai",
    descriptionText: "Install code-review",
    visibleText: "Run a final code review on a pull request",
    metadata: true,
    skillLayout: true,
    profileAuthor: {
      handle: "openai",
      path: "/library/openai/",
    },
    allowNoindex: true,
    markdownText: "# code-review",
  },
  {
    path: "/skills/obra/superpowers/systematic-debugging/",
    canonical: "https://omgskills.com/skills/obra/superpowers/systematic-debugging/",
    text: "systematic-debugging",
    allowNoindex: true,
    profileAuthor: {
      handle: "obra",
      path: "/library/obra/",
    },
    markdownText: "# systematic-debugging",
  },
  {
    path: "/skills/openai/codex/code-review-change-size/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review-change-size/",
    text: "code-review-change-size",
    allowNoindex: true,
    markdownText: "# code-review-change-size",
  },
  {
    path: "/skills/",
    canonical: "https://omgskills.com/skills/",
    text: "The best &amp; latest skills from the most trusted sources",
    directoryImages: true,
    skillLayout: true,
    markdownText: "# omgskills web library",
  },
  {
    path: "/developers/",
    canonical: "https://omgskills.com/developers/",
    text: "omgskills developer resources",
    titleText: "omgskills developer resources",
    descriptionText: "read-only omgskills MCP server",
    markdownText: "# omgskills developer resources",
    developerResources: true,
  },
];

const rootFiles = [
  {
    path: "/robots.txt",
    text: "Sitemap: https://omgskills.com/sitemap.xml",
  },
  {
    path: "/llms.txt",
    text: "omgskills is a Mac app and public web library",
  },
  {
    path: "/agents.md",
    text: "# omgskills agent discovery",
  },
  {
    path: "/llms-gold.txt",
    text: "# omgskills - curated Gold library export",
  },
  {
    path: "/.well-known/ai-catalog.json",
    text: '"identifier": "urn:air:omgskills.com:mcp:catalog"',
  },
];

const redirects = [
  {
    path: "/guide",
    location: "/guide/",
  },
  {
    path: "/profiles/openai/",
    location: "/library/openai/",
  },
  {
    path: "/profiles/openai",
    location: "/library/openai/",
  },
  {
    path: "/profiles/jonslimak/",
    location: "/u/jonslimak/",
  },
];

function localPathForUrlPath(urlPath) {
  const cleanPath = urlPath.replace(/^\/+/, "");
  return path.join(siteDir, cleanPath);
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} did not contain ${needle}`);
  }
}

function assertNotIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label} unexpectedly contained ${needle}`);
  }
}

function assertOccurrenceCount(haystack, needle, expected, label) {
  const actual = haystack.split(needle).length - 1;
  if (actual !== expected) {
    throw new Error(`${label} contained ${actual} occurrences of ${needle}; expected ${expected}`);
  }
}

function verifyAiCatalog(catalog, label) {
  if (catalog?.specVersion !== "1.0") {
    throw new Error(`${label} must use ARD specVersion 1.0`);
  }
  if (catalog?.host?.displayName !== "omgskills") {
    throw new Error(`${label} must identify omgskills as its host`);
  }
  if (catalog?.host?.documentationUrl !== `${origin}/developers/`) {
    throw new Error(`${label} must link to the omgskills developer resources`);
  }
  const entry = catalog?.entries?.find(
    (candidate) => candidate.identifier === "urn:air:omgskills.com:mcp:catalog",
  );
  if (!entry || entry.type !== "application/mcp-server-card+json") {
    throw new Error(`${label} must contain the omgskills MCP server card`);
  }
  if (entry.data?.endpoint !== `${origin}/mcp` || entry.data?.access !== "read-only") {
    throw new Error(`${label} must identify the read-only hosted MCP endpoint`);
  }
  const toolNames = new Set((entry.data?.tools || []).map((tool) => tool.name));
  for (const toolName of [
    "search_skills",
    "get_skill",
    "list_trending",
    "list_gold_basket",
    "list_by_author",
  ]) {
    if (!toolNames.has(toolName)) {
      throw new Error(`${label} is missing MCP tool ${toolName}`);
    }
  }
  if (!Array.isArray(entry.representativeQueries) || entry.representativeQueries.length < 2) {
    throw new Error(`${label} must provide representative queries for discovery`);
  }
}

function verifyHomepageTrustMetadata(html, label) {
  assertIncludes(html, '<link rel="canonical" href="https://omgskills.com/">', label);
  assertIncludes(html, '<link rel="alternate" type="application/ai-catalog+json" href="/.well-known/ai-catalog.json">', label);
  assertIncludes(html, '<meta property="og:type" content="website">', label);
  assertIncludes(html, '<meta property="og:site_name" content="omgskills">', label);
  assertIncludes(html, '<meta property="og:image" content="https://omgskills.com/banner.webp">', label);
  assertIncludes(html, '<meta name="twitter:card" content="summary_large_image">', label);
  assertIncludes(html, '<a href="/about/">About</a>', label);

  const structuredData = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => {
      try {
        return JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`${label} contained invalid JSON-LD: ${error.message}`);
      }
    });
  const graph = structuredData.flatMap((item) => item?.["@graph"] || [item]);
  const organization = graph.find((item) => item?.["@type"] === "Organization");
  const website = graph.find((item) => item?.["@type"] === "WebSite");
  const application = graph.find((item) => item?.["@type"] === "SoftwareApplication");

  if (!organization || !website || !application) {
    throw new Error(`${label} must define Organization, WebSite, and SoftwareApplication JSON-LD`);
  }
  if (!organization.sameAs?.includes("https://github.com/jonslimak/omgskills")) {
    throw new Error(`${label} Organization JSON-LD is missing the omgskills GitHub sameAs link`);
  }
  if (!organization.sameAs?.includes("https://x.com/omgskills")) {
    throw new Error(`${label} Organization JSON-LD is missing the omgskills X sameAs link`);
  }
  if (
    organization.contactPoint?.email !== "hi@omgskills.com"
    || organization.contactPoint?.url !== "https://omgskills.com/support/"
    || organization.contactPoint?.contactType !== "customer support"
  ) {
    throw new Error(`${label} Organization JSON-LD is missing the public support contact point`);
  }
  if (website.publisher?.["@id"] !== organization["@id"] || application.publisher?.["@id"] !== organization["@id"]) {
    throw new Error(`${label} JSON-LD entities do not share the Organization publisher`);
  }
  if (application.operatingSystem !== "macOS" || application.offers?.price !== "0") {
    throw new Error(`${label} SoftwareApplication JSON-LD must describe the free macOS app`);
  }
}

function internalLinks(html) {
  return [...html.matchAll(/\s+href="([^"#][^"]*)"/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith("/") && !href.startsWith("//"));
}

function sameOriginPaths(text) {
  const references = new Set(internalLinks(text));
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of text.matchAll(new RegExp(`${escapedOrigin}(/[^\\s"'<>\\])}]*)`, "g"))) {
    references.add(match[1]);
  }
  return [...references];
}

async function localUrlExists(urlPath) {
  const cleanPath = urlPath.split(/[?#]/)[0];
  const filePath = cleanPath.endsWith("/")
    ? localPathForUrlPath(path.posix.join(cleanPath, "index.html"))
    : localPathForUrlPath(cleanPath);
  if (await fileExists(filePath)) return true;
  if (!path.extname(cleanPath)) {
    return fileExists(localPathForUrlPath(path.posix.join(cleanPath, "index.html")));
  }
  return false;
}

async function collectFiles(directory, suffix) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files;
}

async function collectLocalReferenceFailures(text, label, failures) {
  for (const urlPath of sameOriginPaths(text)) {
    if (urlPath === "/profiles" || urlPath.startsWith("/profiles/")) {
      failures.add(`${label}: redirect-only URL ${urlPath}`);
    } else if (dynamicLocalPaths.has(urlPath)) {
      continue;
    } else if (!(await localUrlExists(urlPath))) {
      failures.add(`${label}: missing local URL ${urlPath}`);
    }
  }
}

async function verifyAllLocalReferences() {
  const failures = new Set();
  const htmlRoots = ["skills", "library", "collections", "developers"].map((directory) => path.join(siteDir, directory));
  const generatedFiles = (await Promise.all(htmlRoots.flatMap((directory) => [
    collectFiles(directory, ".html"),
    collectFiles(directory, ".md"),
  ]))).flat().sort();
  for (const filePath of generatedFiles) {
    await collectLocalReferenceFailures(await readFile(filePath, "utf8"), filePath, failures);
  }

  const sitemapPath = path.join(siteDir, "sitemap.xml");
  const rootSitemap = await readFile(sitemapPath, "utf8");
  await collectLocalReferenceFailures(rootSitemap, sitemapPath, failures);
  for (const urlPath of sitemapChildPaths(rootSitemap)) {
    const childPath = localPathForUrlPath(urlPath);
    await collectLocalReferenceFailures(await readFile(childPath, "utf8"), childPath, failures);
  }

  const llmsPath = localPathForUrlPath("/llms.txt");
  await collectLocalReferenceFailures(await readFile(llmsPath, "utf8"), llmsPath, failures);
  const llmsGoldPath = localPathForUrlPath("/llms-gold.txt");
  await collectLocalReferenceFailures(await readFile(llmsGoldPath, "utf8"), llmsGoldPath, failures);

  if (failures.size) {
    throw new Error(`Generated web library has unsafe internal references:\n${[...failures].sort().join("\n")}`);
  }
}

async function verifyLocalMarkdownParity() {
  const failures = [];
  const roots = ["skills", "library", "collections", "developers", "guide"].map((directory) => path.join(siteDir, directory));
  for (const root of roots) {
    const [htmlFiles, markdownFiles] = await Promise.all([
      collectFiles(root, ".html"),
      collectFiles(root, ".md"),
    ]);
    for (const htmlPath of htmlFiles.filter((filePath) => path.basename(filePath) === "index.html")) {
      const markdownPath = path.join(path.dirname(htmlPath), "index.md");
      if (!(await fileExists(markdownPath))) failures.push(`Missing Markdown mirror for ${htmlPath}`);
      const html = await readFile(htmlPath, "utf8");
      const relativeDirectory = path.relative(siteDir, path.dirname(htmlPath)).split(path.sep).join("/");
      const urlPath = `/${relativeDirectory}/`;
      const alternate = `<link rel="alternate" type="text/markdown" href="${urlPath}index.md">`;
      if (!html.includes(alternate)) failures.push(`${htmlPath} is missing ${alternate}`);
    }
    for (const markdownPath of markdownFiles.filter((filePath) => path.basename(filePath) === "index.md")) {
      const htmlPath = path.join(path.dirname(markdownPath), "index.html");
      if (!(await fileExists(htmlPath))) failures.push(`Missing HTML page for ${markdownPath}`);
    }
  }
  if (failures.length) {
    throw new Error(`Generated HTML/Markdown parity failed:\n${failures.sort().join("\n")}`);
  }
}

async function verifyLiveInternalLinks(html, label) {
  for (const href of internalLinks(html)) {
    const response = await fetchLive(`${origin}${href}`, { redirect: "manual" });
    if (![200, 301, 302, 308].includes(response.status)) {
      throw new Error(`${label} linked to ${href}, which returned ${response.status}`);
    }
  }
}

function verifyMetadata(html, page, label) {
  assertIncludes(
    html,
    '<a class="brand" href="/skills/" aria-label="omgskills skills library"><span aria-hidden="true">&#128064;</span></a>',
    label,
  );
  assertIncludes(
    html,
    '<a class="cta" href="/downloads/omgskills-mac.dmg"><span class="apple-icon" aria-hidden="true">&#63743;</span>Download for macOS</a>',
    label,
  );
  assertNotIncludes(html, '<a class="cta" href="/">', label);
  if (page.titleText) assertIncludes(html, page.titleText, label);
  if (page.descriptionText) assertIncludes(html, page.descriptionText, label);
  if (page.visibleText) assertIncludes(html, page.visibleText, label);
  if (page.noindex) {
    assertIncludes(html, '<meta name="robots" content="noindex,follow">', label);
  } else if (!page.allowNoindex) {
    assertNotIncludes(html, '<meta name="robots" content="noindex,follow">', label);
  }
  assertIncludes(html, '<meta property="og:title"', label);
  assertIncludes(html, '<meta property="og:description"', label);
  assertIncludes(html, '<meta name="twitter:title"', label);
  assertIncludes(html, '<script type="application/ld+json">', label);

  if (page.metadata) {
    assertIncludes(html, '<meta property="og:type"', label);
    assertIncludes(html, '<meta property="og:site_name" content="omgskills">', label);
    assertIncludes(html, '<meta name="twitter:card" content="summary">', label);
    assertIncludes(html, '"@type":"SoftwareApplication"', label);
    assertIncludes(html, '"operatingSystem":"macOS"', label);
    assertIncludes(html, '"@type":"BreadcrumbList"', label);
    assertIncludes(html, '<h2>Install</h2>', label);
    assertNotIncludes(html, 'Install this Claude and Codex skill with the command below.', label);
    assertNotIncludes(html, 'class="install-head"', label);
    assertIncludes(html, 'aria-label="Copy install command" title="Copy install command"', label);
    assertIncludes(html, 'class="copy-icon" data-copy-icon', label);
    assertIncludes(html, 'class="copy-icon" data-copied-icon', label);
  }

  if (page.profileMetadata) {
    assertIncludes(html, '<meta property="og:image"', label);
    assertIncludes(html, '"sameAs":["https://github.com/openai"]', label);
    assertIncludes(html, '<div class="entity-hero">', label);
    assertIncludes(html, 'class="avatar entity-avatar"', label);
    assertIncludes(html, 'class="stat stat-best-skill"', label);
    assertNotIncludes(html, '<div class="eyebrow">Profile</div>', label);
    assertNotIncludes(html, '<div class="meta"><span>@openai</span>', label);
  }

  if (page.profileSocialLinks) {
    assertIncludes(html, `class="entity-social-link" href="${page.profileSocialLinks.github}"`, label);
    assertIncludes(html, `aria-label="${page.text} on GitHub"`, label);
    assertIncludes(html, `class="entity-social-link" href="${page.profileSocialLinks.x}"`, label);
    assertIncludes(html, `aria-label="${page.text} on X"`, label);
    assertIncludes(html, '.entity-social-link svg { display: block; width: 18px; height: 18px; }', label);
  }

  if (page.collectionMetadata) {
    assertIncludes(html, '<div class="entity-hero">', label);
    assertIncludes(html, 'class="avatar entity-avatar"', label);
    if (page.collectionSubtitle) {
      assertIncludes(html, `<p class="entity-subtitle">${escapeHtml(page.collectionSubtitle)}</p>`, label);
    }
    if (page.collectionDescription) {
      assertIncludes(html, `<p>${escapeHtml(page.collectionDescription)}</p>`, label);
    }
    assertNotIncludes(html, '<div class="eyebrow">Collection</div>', label);
    const collectionHeader = html.slice(html.indexOf('<div class="entity-hero">'), html.indexOf('<div class="section skill-section"'));
    assertNotIncludes(collectionHeader, `<div class="meta"><span>${page.collectionSkillCount} skills</span></div>`, label);
  }

  if (page.recommendations) {
    assertIncludes(html, '<div class="eyebrow">Others you might like</div>', label);
    assertOccurrenceCount(html, "data-recommendation-card", 3, label);
    assertNotIncludes(html, `data-recommendation-card href="${page.recommendations.currentPath}"`, label);
  }

  if (page.profileAuthor) {
    assertIncludes(
      html,
      `class="skill-detail-author" href="${page.profileAuthor.path}"`,
      label,
    );
    assertIncludes(html, 'class="skill-detail-title"', label);
    assertIncludes(html, 'class="skill-detail-author-avatar" aria-hidden="true"', label);
    assertIncludes(html, `src="https://github.com/${page.profileAuthor.handle}.png"`, label);
    assertIncludes(html, 'class="skill-detail-stars" aria-label="', label);
    assertIncludes(html, 'class="entity-social-link skill-detail-github-link"', label);
    assertIncludes(html, `aria-label="View ${page.text} on GitHub"`, label);
    assertIncludes(html, '.skill-detail-author { color: var(--blue); }', label);
    assertIncludes(html, '.skill-detail > .section > h2, .skill-detail > .skill-section .section-heading h2 { color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }', label);
    assertIncludes(html, '.skill-detail > .section:not(.skill-section) > p { font-size: 13px; }', label);
    assertNotIncludes(html, 'Author match:', label);
    assertNotIncludes(html, ' stars</span>', label);
    assertIncludes(html, `${origin}${page.profileAuthor.path}`, label);
  }

  if (page.skillLayout) {
    assertIncludes(html, 'class="section skill-section" data-skill-section', label);
    assertIncludes(html, 'data-skill-view-toggle data-next-view="list" aria-label="Switch to list view"', label);
    assertIncludes(html, 'data-skill-view-icon="list"', label);
    assertIncludes(html, 'data-skill-view-icon="grid" hidden', label);
    assertIncludes(html, 'class="grid skill-grid" data-skill-grid data-view="grid"', label);
    assertIncludes(html, 'class="card skill-card"', label);
    assertIncludes(html, 'class="skill-card-heading"', label);
    assertIncludes(html, 'class="skill-card-stars" aria-label="', label);
    assertIncludes(html, 'class="skill-card-star-icon"', label);
    assertIncludes(html, 'class="skill-card-author"', label);
    assertIncludes(html, 'class="skill-card-author-avatar" aria-hidden="true"', label);
    assertIncludes(html, 'loading="lazy" decoding="async"', label);
    assertIncludes(html, 'grid-column: 3; grid-row: 1;', label);
    assertIncludes(html, 'grid-column: 4; grid-row: 1;', label);
    assertIncludes(html, 'const skillViewStorageKey = "omgskills-skill-view";', label);
  }

  if (page.directoryImages) {
    assertIncludes(html, 'class="directory-card-heading"', label);
    assertIncludes(html, 'class="directory-card-image"', label);
    assertIncludes(html, 'class="directory-card-subtitle"', label);
    assertIncludes(html, 'class="directory-card-description"', label);
    assertNotIncludes(html, '<div class="meta"><span>@anthropics</span></div>', label);
    assertIncludes(html, 'profile image" loading="lazy" decoding="async"', label);
    assertIncludes(html, 'collection image" loading="lazy" decoding="async"', label);
  }

  if (page.developerResources) {
    assertIncludes(html, `${origin}/mcp`, label);
    assertIncludes(html, "npx -y omgskills-mcp", label);
    assertIncludes(html, "https://www.npmjs.com/package/omgskills-mcp", label);
    assertIncludes(html, "/data/manifest.json", label);
    assertIncludes(html, "/.well-known/ai-catalog.json", label);
    assertIncludes(html, "/skills/index.md", label);
    assertIncludes(html, "The MCP tools only read public catalog data.", label);
  }

  if (page.githubAuthor) {
    assertIncludes(
      html,
      `href="${page.githubAuthor.url}">@${page.githubAuthor.handle}</a>`,
      label,
    );
    assertNotIncludes(html, `/library/${page.githubAuthor.handle}/`, label);
    assertNotIncludes(html, `/profiles/${page.githubAuthor.handle}/`, label);
  }
}

async function verifyLocalPage(page) {
  const filePath = localPathForUrlPath(path.posix.join(page.path, "index.html"));
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing generated page: ${filePath}`);
  }

  const html = await readFile(filePath, "utf8");
  assertIncludes(html, `<link rel="canonical" href="${page.canonical}">`, filePath);
  assertIncludes(html, `<link rel="alternate" type="text/markdown" href="${page.path}index.md">`, filePath);
  assertIncludes(html, '<link rel="alternate" type="application/ai-catalog+json" href="/.well-known/ai-catalog.json">', filePath);
  assertIncludes(html, page.text, filePath);
  verifyMetadata(html, page, filePath);

  const markdownPath = localPathForUrlPath(path.posix.join(page.path, "index.md"));
  if (!(await fileExists(markdownPath))) {
    throw new Error(`Missing Markdown mirror: ${markdownPath}`);
  }
  const markdown = await readFile(markdownPath, "utf8");
  assertIncludes(markdown, page.markdownText, markdownPath);
  assertIncludes(markdown, page.canonical, markdownPath);
}

async function verifyLocalSitemap() {
  const sitemapPath = path.join(siteDir, "sitemap.xml");
  if (!(await fileExists(sitemapPath))) {
    throw new Error(`Missing generated sitemap: ${sitemapPath}`);
  }

  const sitemap = await localSitemapContents(sitemapPath);
  for (const page of pages) {
    const pagePath = localPathForUrlPath(path.posix.join(page.path, "index.html"));
    assertIndexStateMatchesSitemap({
      html: await readFile(pagePath, "utf8"),
      sitemap,
      canonical: page.canonical,
      label: sitemapPath,
    });
  }
  assertIncludes(sitemap, "<loc>https://omgskills.com/about/</loc>", sitemapPath);
  assertIncludes(sitemap, "<lastmod>", sitemapPath);
  assertNotIncludes(sitemap, "index.md", sitemapPath);
  assertNotIncludes(sitemap, "llms-gold.txt", sitemapPath);
}

async function verifyLocalRootFile(file) {
  const filePath = localPathForUrlPath(file.path);
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing root metadata file: ${filePath}`);
  }
  const contents = await readFile(filePath, "utf8");
  assertIncludes(contents, file.text, filePath);
  if (file.path === "/llms.txt") {
    assertIncludes(contents, "## Markdown mirrors", filePath);
    assertIncludes(contents, "## For agents & developers", filePath);
    assertIncludes(contents, `${origin}/developers/index.md`, filePath);
    assertIncludes(contents, `${origin}/mcp`, filePath);
    assertIncludes(contents, `${origin}/.well-known/ai-catalog.json`, filePath);
    assertIncludes(contents, "https://www.npmjs.com/package/omgskills-mcp", filePath);
    assertIncludes(contents, `${origin}/skills/index.md`, filePath);
    assertIncludes(contents, `${origin}/llms-gold.txt`, filePath);
    assertIncludes(contents, "## When to use omgskills", filePath);
    assertIncludes(contents, `${origin}/agents.md`, filePath);
    assertIncludes(contents, `${origin}/guide/index.md`, filePath);
    assertIncludes(contents, `${origin}/guide/`, filePath);
  }
  if (file.path === "/agents.md") {
    assertIncludes(contents, "## When to use omgskills", filePath);
    assertIncludes(contents, "read-only MCP endpoint", filePath);
    assertIncludes(contents, "use the macOS app to install or manage skills", filePath);
    assertIncludes(contents, `${origin}/developers/index.md`, filePath);
    assertIncludes(contents, `${origin}/.well-known/ai-catalog.json`, filePath);
  }
  if (file.path === "/.well-known/ai-catalog.json") {
    verifyAiCatalog(JSON.parse(contents), filePath);
  }
  if (file.path === "/llms-gold.txt") {
    assertIncludes(contents, `Source: ${origin}/skills/`, filePath);
    assertIncludes(contents, `Source: ${origin}/library/`, filePath);
    const sourcePaths = [...contents.matchAll(/^Source: (\S+)$/gm)].map((match) => {
      if (!match[1].startsWith(`${origin}/`)) {
        throw new Error(`${filePath} contained a non-canonical source URL: ${match[1]}`);
      }
      return match[1].slice(origin.length);
    });
    if (sourcePaths.length === 0) {
      throw new Error(`${filePath} contained no canonical source paths`);
    }
    const sortedPaths = [...sourcePaths].sort((a, b) => a.localeCompare(b));
    if (sourcePaths.join("\n") !== sortedPaths.join("\n")) {
      throw new Error(`${filePath} source paths were not deterministic`);
    }
    if (new Set(sourcePaths).size !== sourcePaths.length) {
      throw new Error(`${filePath} contained duplicate source paths`);
    }
  }
}

function verifyGuideHtml(html, label) {
  assertIncludes(html, '<link rel="canonical" href="https://omgskills.com/guide/">', label);
  assertIncludes(html, '<link rel="alternate" type="text/markdown" href="/guide/index.md">', label);
  assertIncludes(html, '<h1>Skills: The Complete Guide</h1>', label);
  assertIncludes(html, '<meta property="og:image" content="https://omgskills.com/images/guide/share.png">', label);
  assertIncludes(html, '<meta property="og:image:width" content="1200">', label);
  assertIncludes(html, '<meta property="og:image:height" content="630">', label);
  assertIncludes(html, '<meta name="twitter:card" content="summary_large_image">', label);
  const structuredData = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  const article = structuredData.find((entry) => entry["@type"] === "TechArticle");
  const faq = structuredData.find((entry) => entry["@type"] === "FAQPage");
  if (!article) throw new Error(`${label} did not contain TechArticle JSON-LD`);
  if (!faq) throw new Error(`${label} did not contain FAQPage JSON-LD`);
  if (article.dateModified !== "2026-08-19") {
    throw new Error(`${label} had unexpected TechArticle dateModified ${article.dateModified || "<missing>"}`);
  }
  const questions = new Map((faq.mainEntity || []).map((entry) => [entry.name, entry.acceptedAnswer?.text]));
  if (!questions.get("Are skills safe?")?.includes("Skills are instructions, not code")) {
    throw new Error(`${label} did not contain the visible skills safety answer in FAQPage JSON-LD`);
  }
  if (!questions.get("Are skills free?")?.includes("All 49,000+ indexed here are free.")) {
    throw new Error(`${label} did not contain the visible free-skills answer in FAQPage JSON-LD`);
  }
}

function verifyGuideMarkdown(markdown, label) {
  assertIncludes(markdown, "# Skills: The Complete Guide", label);
  assertIncludes(markdown, "## Are skills safe?", label);
  assertIncludes(markdown, "Skills are instructions, not code", label);
  assertIncludes(markdown, "## Are skills free?", label);
  assertIncludes(markdown, "All 49,000+ indexed here are free.", label);
  assertIncludes(markdown, `${origin}/guide/`, label);
}

async function verifyLocalGuide() {
  const htmlPath = localPathForUrlPath("/guide/index.html");
  const markdownPath = localPathForUrlPath("/guide/index.md");
  const imagePath = localPathForUrlPath("/images/guide/share.png");
  if (!(await fileExists(markdownPath))) throw new Error(`Missing guide Markdown mirror: ${markdownPath}`);
  if (!(await fileExists(imagePath))) throw new Error(`Missing guide social image: ${imagePath}`);
  verifyGuideHtml(await readFile(htmlPath, "utf8"), htmlPath);
  verifyGuideMarkdown(await readFile(markdownPath, "utf8"), markdownPath);
  const redirectRules = await readFile(path.join(siteDir, "_redirects"), "utf8");
  assertNotIncludes(redirectRules, "/guide /guide/index.html 200", path.join(siteDir, "_redirects"));
  assertNotIncludes(redirectRules, "/guide /guide/ 301", path.join(siteDir, "_redirects"));
  const netlifyConfig = await readFile(path.join(repoRoot, "netlify.toml"), "utf8");
  assertIncludes(netlifyConfig, 'for = "/guide/index.md"', path.join(repoRoot, "netlify.toml"));
}

async function verifyLiveGuide() {
  const htmlUrl = `${origin}/guide/`;
  const htmlResponse = await fetchLive(htmlUrl, { redirect: "manual" });
  if (htmlResponse.status !== 200) throw new Error(`${htmlUrl} returned ${htmlResponse.status}, expected 200`);
  verifyGuideHtml(await htmlResponse.text(), htmlUrl);

  const markdownUrl = `${origin}/guide/index.md`;
  const markdownResponse = await fetchLive(markdownUrl, { redirect: "manual" });
  if (markdownResponse.status !== 200) throw new Error(`${markdownUrl} returned ${markdownResponse.status}, expected 200`);
  const markdownType = markdownResponse.headers.get("content-type") || "";
  if (!markdownType.toLowerCase().startsWith("text/markdown")) {
    throw new Error(`${markdownUrl} returned Content-Type ${markdownType || "<missing>"}, expected text/markdown`);
  }
  const robots = markdownResponse.headers.get("x-robots-tag") || "";
  if (!robots.toLowerCase().includes("noindex")) {
    throw new Error(`${markdownUrl} returned X-Robots-Tag ${robots || "<missing>"}, expected noindex`);
  }
  verifyGuideMarkdown(await markdownResponse.text(), markdownUrl);

  const imageUrl = `${origin}/images/guide/share.png`;
  const imageResponse = await fetchLive(imageUrl, { redirect: "manual" });
  if (imageResponse.status !== 200) throw new Error(`${imageUrl} returned ${imageResponse.status}, expected 200`);
  const imageType = imageResponse.headers.get("content-type") || "";
  if (!imageType.toLowerCase().startsWith("image/png")) {
    throw new Error(`${imageUrl} returned Content-Type ${imageType || "<missing>"}, expected image/png`);
  }
}

function verifyCatalogSkillUrlCoverage(asset, label) {
  const entries = catalogSkillUrlEntries(asset);
  if (entries.length === 0) {
    throw new Error(`${label} contained no generated skill URLs`);
  }
  const generatedPaths = new Set(entries.map(([, urlPath]) => urlPath));
  for (const page of pages) {
    if (page.path.startsWith("/skills/") && page.path !== "/skills/" && !generatedPaths.has(page.path)) {
      throw new Error(`${label} did not map a generated page: ${page.path}`);
    }
  }
  return entries;
}

async function verifyLocalCatalogSkillUrls() {
  const filePath = path.join(siteDir, catalogSkillUrlsFilename);
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing generated catalog skill URL asset: ${filePath}`);
  }
  const entries = verifyCatalogSkillUrlCoverage(JSON.parse(await readFile(filePath, "utf8")), filePath);
  for (const [, urlPath] of entries) {
    if (!(await localUrlExists(urlPath))) {
      throw new Error(`${filePath} mapped a missing generated page: ${urlPath}`);
    }
  }
}

async function verifyLocalGeneratedRedirects() {
  const filePath = path.join(siteDir, "_web-library-redirects");
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing generated web library redirects: ${filePath}`);
  }
  const contents = await readFile(filePath, "utf8");
  const catalogAsset = JSON.parse(
    await readFile(path.join(siteDir, catalogSkillUrlsFilename), "utf8"),
  );
  const generatedUrlById = new Map(catalogSkillUrlEntries(catalogAsset));
  for (const redirect of legacyCatalogSkillRedirects) {
    const location = generatedUrlById.get(redirect.catalogSkillId);
    if (!location) {
      throw new Error(
        `${catalogSkillUrlsFilename} did not map legacy redirect target ${redirect.catalogSkillId}`,
      );
    }
    assertIncludes(contents, `${redirect.path}  ${location}  301`, filePath);
  }
}

async function verifyLocalHomepageLibraryPreview() {
  const filePath = path.join(siteDir, "index.html");
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing homepage: ${filePath}`);
  }
  const html = await readFile(filePath, "utf8");
  verifyHomepageLibraryPreview(html, filePath);
  verifyHomepageTrustMetadata(html, filePath);
  assertIncludes(html, '<a href="/developers/">Developers</a>', filePath);
  for (const requiredPath of ["/about/", "/banner.webp"]) {
    if (!(await localUrlExists(requiredPath))) {
      throw new Error(`${filePath} requires missing local resource: ${requiredPath}`);
    }
  }
  const aboutPath = localPathForUrlPath("/about/index.html");
  const aboutHtml = await readFile(aboutPath, "utf8");
  assertIncludes(aboutHtml, '<link rel="canonical" href="https://omgskills.com/about/">', aboutPath);
  assertIncludes(aboutHtml, "<h1>About omgskills</h1>", aboutPath);
  assertIncludes(aboutHtml, '<a href="/developers/">developer resources</a>', aboutPath);
  for (const urlPath of homepageLibraryPaths) {
    if (!(await localUrlExists(urlPath))) {
      throw new Error(`${filePath} linked to a missing profile page: ${urlPath}`);
    }
  }
}

async function verifyLivePage(page) {
  const url = `${origin}${page.path}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const html = await response.text();
  livePageHtmlByPath.set(page.path, html);
  assertIncludes(html, `<link rel="canonical" href="${page.canonical}">`, url);
  assertIncludes(html, `<link rel="alternate" type="text/markdown" href="${page.path}index.md">`, url);
  assertIncludes(html, '<link rel="alternate" type="application/ai-catalog+json" href="/.well-known/ai-catalog.json">', url);
  assertIncludes(html, page.text, url);
  verifyMetadata(html, page, url);
  await verifyLiveInternalLinks(html, url);

  const markdownUrl = `${origin}${page.path}index.md`;
  const markdownResponse = await fetchLive(markdownUrl, { redirect: "manual" });
  if (markdownResponse.status !== 200) {
    throw new Error(`${markdownUrl} returned ${markdownResponse.status}, expected 200`);
  }
  const contentType = markdownResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("text/markdown")) {
    throw new Error(`${markdownUrl} returned Content-Type ${contentType || "<missing>"}, expected text/markdown`);
  }
  const robots = markdownResponse.headers.get("x-robots-tag") || "";
  if (!robots.toLowerCase().includes("noindex")) {
    throw new Error(`${markdownUrl} returned X-Robots-Tag ${robots || "<missing>"}, expected noindex`);
  }
  const markdown = await markdownResponse.text();
  assertIncludes(markdown, page.markdownText, markdownUrl);
  assertIncludes(markdown, page.canonical, markdownUrl);
}

async function verifyLiveHomepageLibraryPreview() {
  const url = `${origin}/`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }
  const html = await response.text();
  verifyHomepageLibraryPreview(html, url);
  verifyHomepageTrustMetadata(html, url);
  assertIncludes(html, '<a href="/developers/">Developers</a>', url);
  await verifyLiveInternalLinks(html, url);

  const socialImageResponse = await fetchLive(`${origin}/banner.webp`, { redirect: "manual" });
  if (socialImageResponse.status !== 200) {
    throw new Error(`${origin}/banner.webp returned ${socialImageResponse.status}, expected 200`);
  }
  const contentType = socialImageResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/webp")) {
    throw new Error(`${origin}/banner.webp returned Content-Type ${contentType || "<missing>"}, expected image/webp`);
  }
}

async function verifyLiveSitemap() {
  const url = `${origin}/sitemap.xml`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const sitemap = await liveSitemapContents(url, await response.text());
  for (const page of pages) {
    const html = livePageHtmlByPath.get(page.path);
    if (!html) throw new Error(`Missing fetched page content for ${origin}${page.path}`);
    assertIndexStateMatchesSitemap({
      html,
      sitemap,
      canonical: page.canonical,
      label: url,
    });
  }
  assertIncludes(sitemap, "<loc>https://omgskills.com/about/</loc>", url);
  assertIncludes(sitemap, "<lastmod>", url);
  assertNotIncludes(sitemap, "index.md", url);
}

function sitemapChildPaths(xml) {
  return [...xml.matchAll(/<loc>https:\/\/omgskills\.com(\/sitemap-\d+\.xml)<\/loc>/g)].map((match) => match[1]);
}

async function localSitemapContents(sitemapPath) {
  const xml = await readFile(sitemapPath, "utf8");
  const childPaths = sitemapChildPaths(xml);
  if (!childPaths.length) return xml;
  const children = await Promise.all(childPaths.map((urlPath) => readFile(localPathForUrlPath(urlPath), "utf8")));
  return [xml, ...children].join("\n");
}

async function liveSitemapContents(rootUrl, xml) {
  const childPaths = sitemapChildPaths(xml);
  if (!childPaths.length) return xml;
  const children = [];
  for (const urlPath of childPaths) {
    const response = await fetchLive(`${origin}${urlPath}`, { redirect: "manual" });
    if (response.status !== 200) {
      throw new Error(`${rootUrl} referenced ${urlPath}, which returned ${response.status}`);
    }
    children.push(await response.text());
  }
  return [xml, ...children].join("\n");
}

async function verifyLiveRootFile(file) {
  const url = `${origin}${file.path}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }
  const contents = await response.text();
  assertIncludes(contents, file.text, url);
  if (file.path === "/llms.txt") {
    assertIncludes(contents, "## Markdown mirrors", url);
    assertIncludes(contents, "## For agents & developers", url);
    assertIncludes(contents, `${origin}/developers/index.md`, url);
    assertIncludes(contents, `${origin}/mcp`, url);
    assertIncludes(contents, `${origin}/.well-known/ai-catalog.json`, url);
    assertIncludes(contents, "https://www.npmjs.com/package/omgskills-mcp", url);
    assertIncludes(contents, `${origin}/skills/index.md`, url);
    assertIncludes(contents, `${origin}/llms-gold.txt`, url);
    assertIncludes(contents, "## When to use omgskills", url);
    assertIncludes(contents, `${origin}/agents.md`, url);
  }
  if (file.path === "/agents.md") {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("text/markdown")) {
      throw new Error(`${url} returned Content-Type ${contentType || "<missing>"}, expected text/markdown`);
    }
    assertIncludes(contents, "## When to use omgskills", url);
    assertIncludes(contents, "read-only MCP endpoint", url);
    assertIncludes(contents, "use the macOS app to install or manage skills", url);
    assertIncludes(contents, `${origin}/developers/index.md`, url);
    assertIncludes(contents, `${origin}/.well-known/ai-catalog.json`, url);
  }
  if (file.path === "/.well-known/ai-catalog.json") {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new Error(`${url} returned Content-Type ${contentType || "<missing>"}, expected application/json`);
    }
    const cors = response.headers.get("access-control-allow-origin") || "";
    if (cors !== "*") {
      throw new Error(`${url} returned Access-Control-Allow-Origin ${cors || "<missing>"}, expected *`);
    }
    verifyAiCatalog(JSON.parse(contents), url);
  }
  if (file.path === "/llms-gold.txt") {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("text/plain")) {
      throw new Error(`${url} returned Content-Type ${contentType || "<missing>"}, expected text/plain`);
    }
    const robots = response.headers.get("x-robots-tag") || "";
    if (!robots.toLowerCase().includes("noindex")) {
      throw new Error(`${url} returned X-Robots-Tag ${robots || "<missing>"}, expected noindex`);
    }
    assertIncludes(contents, `Source: ${origin}/skills/`, url);
  }
}

async function verifyLiveCatalogSkillUrls() {
  const url = `${origin}/${catalogSkillUrlsFilename}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }
  return verifyCatalogSkillUrlCoverage(await response.json(), url);
}

function llmsUrls(text) {
  return [...text.matchAll(/https:\/\/omgskills\.com([^\s)]+)/g)]
    .map((match) => match[1])
    .filter((urlPath) => urlPath.startsWith("/"));
}

async function verifyLiveLlmsLinks() {
  const response = await fetchLive(`${origin}/llms.txt`, { redirect: "manual" });
  const text = await response.text();
  for (const urlPath of llmsUrls(text)) {
    const linkResponse = await fetchLive(`${origin}${urlPath}`, { redirect: "manual" });
    if (urlPath === "/mcp" && linkResponse.status === 405) continue;
    if (linkResponse.status !== 200) {
      throw new Error(`${origin}/llms.txt linked to ${urlPath}, which returned ${linkResponse.status}`);
    }
  }
}

async function verifyLiveRedirect(redirect) {
  const url = `${origin}${redirect.path}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 301) {
    throw new Error(`${url} returned ${response.status}, expected 301`);
  }

  const location = response.headers.get("location");
  if (location !== redirect.location) {
    throw new Error(`${url} redirected to ${location}, expected ${redirect.location}`);
  }
}

async function main() {
  if (isLive) {
    await verifyLiveHomepageLibraryPreview();
    await verifyLiveGuide();
    for (const page of pages) await verifyLivePage(page);
    for (const file of rootFiles) await verifyLiveRootFile(file);
    const generatedUrlById = new Map(await verifyLiveCatalogSkillUrls());
    await verifyLiveLlmsLinks();
    await verifyLiveSitemap();
    for (const redirect of legacyCatalogSkillRedirects) {
      const location = generatedUrlById.get(redirect.catalogSkillId);
      if (!location) {
        throw new Error(
          `${origin}/${catalogSkillUrlsFilename} did not map legacy redirect target ${redirect.catalogSkillId}`,
        );
      }
      await verifyLiveRedirect({ path: redirect.path, location });
    }
    for (const redirect of redirects) await verifyLiveRedirect(redirect);
    console.log("Live web library pages verified");
    return;
  }

  for (const page of pages) await verifyLocalPage(page);
  await verifyLocalHomepageLibraryPreview();
  await verifyLocalGuide();
  for (const file of rootFiles) await verifyLocalRootFile(file);
  await verifyLocalCatalogSkillUrls();
  await verifyLocalGeneratedRedirects();
  await verifyLocalSitemap();
  await verifyLocalMarkdownParity();
  await verifyAllLocalReferences();
  console.log("Local web library pages verified");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
