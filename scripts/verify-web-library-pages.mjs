#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isLive = process.argv.includes("--live");
const liveFetchAttempts = 3;

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
    text: "Starter Pack",
    titleText: "Starter Pack",
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
    allowNoindex: true,
  },
  {
    path: "/skills/openai/codex/code-review-change-size/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review-change-size/",
    text: "code-review-change-size",
    noindex: true,
    expectSitemap: false,
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

async function localUrlExists(urlPath) {
  const cleanPath = urlPath.split("?")[0];
  const filePath = cleanPath.endsWith("/")
    ? localPathForUrlPath(path.posix.join(cleanPath, "index.html"))
    : localPathForUrlPath(cleanPath);
  if (await fileExists(filePath)) return true;
  if (!path.extname(cleanPath)) {
    return fileExists(localPathForUrlPath(path.posix.join(cleanPath, "index.html")));
  }
  return false;
}

async function verifyLocalInternalLinks(html, label) {
  for (const href of internalLinks(html)) {
    if (!(await localUrlExists(href))) {
      throw new Error(`${label} linked to missing local URL ${href}`);
    }
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
  await verifyLocalInternalLinks(html, filePath);
}

async function verifyLocalSitemap() {
  const sitemapPath = path.join(siteDir, "sitemap.xml");
  if (!(await fileExists(sitemapPath))) {
    throw new Error(`Missing generated sitemap: ${sitemapPath}`);
  }

  const sitemap = await localSitemapContents(sitemapPath);
  for (const page of pages) {
    if (page.allowNoindex) continue;
    const loc = `<loc>${page.canonical}</loc>`;
    if (page.expectSitemap === false) {
      assertNotIncludes(sitemap, loc, sitemapPath);
    } else {
      assertIncludes(sitemap, loc, sitemapPath);
    }
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

async function verifyLivePage(page) {
  const url = `${origin}${page.path}`;
  const response = await fetchLive(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const html = await response.text();
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
    if (page.allowNoindex) continue;
    const loc = `<loc>${page.canonical}</loc>`;
    if (page.expectSitemap === false) {
      assertNotIncludes(sitemap, loc, url);
    } else {
      assertIncludes(sitemap, loc, url);
    }
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

function llmsUrls(text) {
  return [...text.matchAll(/https:\/\/omgskills\.com([^\s)]+)/g)]
    .map((match) => match[1])
    .filter((urlPath) => urlPath.startsWith("/"));
}

async function verifyLocalLlmsLinks() {
  const filePath = localPathForUrlPath("/llms.txt");
  const text = await readFile(filePath, "utf8");
  for (const urlPath of llmsUrls(text)) {
    if (!(await localUrlExists(urlPath))) {
      throw new Error(`${filePath} linked to missing local URL ${urlPath}`);
    }
  }
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
    await verifyLiveLlmsLinks();
    await verifyLiveSitemap();
    for (const redirect of redirects) await verifyLiveRedirect(redirect);
    console.log("Live web library pages verified");
    return;
  }

  for (const page of pages) await verifyLocalPage(page);
  for (const file of rootFiles) await verifyLocalRootFile(file);
  await verifyLocalLlmsLinks();
  await verifyLocalSitemap();
  console.log("Local web library pages verified");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
