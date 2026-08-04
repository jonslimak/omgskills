#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  catalogSkillUrlEntries,
  catalogSkillUrlsFilename,
  legacyCatalogSkillRedirects,
} from "./web-library-skill-urls.mjs";
import { assertIndexStateMatchesSitemap } from "./web-library-index-verification.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isLive = process.argv.includes("--live");
const liveFetchAttempts = 3;
const livePageHtmlByPath = new Map();

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
  },
  {
    path: "/library/mattpocock/",
    canonical: "https://omgskills.com/library/mattpocock/",
    text: "Matt Pocock",
  },
  {
    path: "/collections/starter-pack/",
    canonical: "https://omgskills.com/collections/starter-pack/",
    text: escapeHtml(starterPack.title),
    titleText: escapeHtml(starterPack.title),
    descriptionText: "Claude and Codex",
  },
  {
    path: "/skills/openai/codex/code-review/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review/",
    text: "code-review",
    titleText: "Claude skill by openai",
    descriptionText: "Install code-review",
    visibleText: "Run a final code review on a pull request",
    metadata: true,
    profileAuthor: {
      handle: "openai",
      path: "/library/openai/",
    },
    allowNoindex: true,
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
  },
  {
    path: "/skills/openai/codex/code-review-change-size/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review-change-size/",
    text: "code-review-change-size",
    allowNoindex: true,
  },
  {
    path: "/skills/",
    canonical: "https://omgskills.com/skills/",
    text: "Browse the current omgskills web library test set",
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
];

const redirects = [
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

function internalLinks(html) {
  return [...html.matchAll(/\s+href="([^"#][^"]*)"/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith("/") && !href.startsWith("//"));
}

function sameOriginPaths(text) {
  const references = new Set(internalLinks(text));
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of text.matchAll(new RegExp(`${escapedOrigin}(/[^\\s"'<>]*)`, "g"))) {
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

async function collectHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectHtmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function collectLocalReferenceFailures(text, label, failures) {
  for (const urlPath of sameOriginPaths(text)) {
    if (urlPath === "/profiles" || urlPath.startsWith("/profiles/")) {
      failures.add(`${label}: redirect-only URL ${urlPath}`);
    } else if (!(await localUrlExists(urlPath))) {
      failures.add(`${label}: missing local URL ${urlPath}`);
    }
  }
}

async function verifyAllLocalReferences() {
  const failures = new Set();
  const htmlRoots = ["skills", "library", "collections"].map((directory) => path.join(siteDir, directory));
  const htmlFiles = (await Promise.all(htmlRoots.map(collectHtmlFiles))).flat().sort();
  for (const filePath of htmlFiles) {
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

  if (failures.size) {
    throw new Error(`Generated web library has unsafe internal references:\n${[...failures].sort().join("\n")}`);
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
    '<a class="brand" href="/" aria-label="omgskills home"><span aria-hidden="true">&#128064;</span></a>',
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
  }

  if (page.profileMetadata) {
    assertIncludes(html, '<meta property="og:image"', label);
    assertIncludes(html, '"sameAs":["https://github.com/openai"]', label);
  }

  if (page.profileAuthor) {
    assertIncludes(
      html,
      `href="${page.profileAuthor.path}">@${page.profileAuthor.handle}</a>`,
      label,
    );
    assertIncludes(html, `${origin}${page.profileAuthor.path}`, label);
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
  assertIncludes(html, page.text, filePath);
  verifyMetadata(html, page, filePath);
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
  assertIncludes(sitemap, "<lastmod>", sitemapPath);
}

async function verifyLocalRootFile(file) {
  const filePath = localPathForUrlPath(file.path);
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing root metadata file: ${filePath}`);
  }
  assertIncludes(await readFile(filePath, "utf8"), file.text, filePath);
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

async function verifyLivePage(page) {
  const url = `${origin}${page.path}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const html = await response.text();
  livePageHtmlByPath.set(page.path, html);
  assertIncludes(html, `<link rel="canonical" href="${page.canonical}">`, url);
  assertIncludes(html, page.text, url);
  verifyMetadata(html, page, url);
  await verifyLiveInternalLinks(html, url);
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
  assertIncludes(sitemap, "<lastmod>", url);
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
  assertIncludes(await response.text(), file.text, url);
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
  for (const file of rootFiles) await verifyLocalRootFile(file);
  await verifyLocalCatalogSkillUrls();
  await verifyLocalGeneratedRedirects();
  await verifyLocalSitemap();
  await verifyAllLocalReferences();
  console.log("Local web library pages verified");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
