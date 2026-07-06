#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isLive = process.argv.includes("--live");

const pages = [
  {
    path: "/profiles/openai/",
    canonical: "https://omgskills.com/profiles/openai/",
    text: "OpenAI",
  },
  {
    path: "/profiles/mattpocock/",
    canonical: "https://omgskills.com/profiles/mattpocock/",
    text: "Matt Pocock",
  },
  {
    path: "/collections/starter-pack/",
    canonical: "https://omgskills.com/collections/starter-pack/",
    text: "Starter Pack",
  },
  {
    path: "/skills/openai/codex/code-review/",
    canonical: "https://omgskills.com/skills/openai/codex/code-review/",
    text: "code-review",
    metadata: true,
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
    path: "/creators/openai/",
    location: "/profiles/openai/",
  },
  {
    path: "/profiles/openai",
    location: "/profiles/openai/",
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

async function verifyLocalPage(page) {
  const filePath = localPathForUrlPath(path.posix.join(page.path, "index.html"));
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing generated page: ${filePath}`);
  }

  const html = await readFile(filePath, "utf8");
  assertIncludes(html, `<link rel="canonical" href="${page.canonical}">`, filePath);
  assertIncludes(html, page.text, filePath);
  if (page.metadata) {
    assertIncludes(html, '<meta property="og:type"', filePath);
    assertIncludes(html, '<meta property="og:site_name" content="omgskills">', filePath);
    assertIncludes(html, '<meta name="twitter:card" content="summary">', filePath);
  }
}

async function verifyLocalSitemap() {
  const sitemapPath = path.join(siteDir, "sitemap.xml");
  if (!(await fileExists(sitemapPath))) {
    throw new Error(`Missing generated sitemap: ${sitemapPath}`);
  }

  const sitemap = await readFile(sitemapPath, "utf8");
  for (const page of pages) {
    assertIncludes(sitemap, `<loc>${page.canonical}</loc>`, sitemapPath);
  }
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
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const html = await response.text();
  assertIncludes(html, `<link rel="canonical" href="${page.canonical}">`, url);
  assertIncludes(html, page.text, url);
  if (page.metadata) {
    assertIncludes(html, '<meta property="og:type"', url);
    assertIncludes(html, '<meta property="og:site_name" content="omgskills">', url);
    assertIncludes(html, '<meta name="twitter:card" content="summary">', url);
  }
}

async function verifyLiveSitemap() {
  const url = `${origin}/sitemap.xml`;
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }

  const sitemap = await response.text();
  for (const page of pages) {
    assertIncludes(sitemap, `<loc>${page.canonical}</loc>`, url);
  }
}

async function verifyLiveRootFile(file) {
  const url = `${origin}${file.path}`;
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} returned ${response.status}, expected 200`);
  }
  assertIncludes(await response.text(), file.text, url);
}

async function verifyLiveRedirect(redirect) {
  const url = `${origin}${redirect.path}`;
  const response = await fetch(url, { redirect: "manual" });
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
    await verifyLiveSitemap();
    for (const redirect of redirects) await verifyLiveRedirect(redirect);
    console.log("Live web library pages verified");
    return;
  }

  for (const page of pages) await verifyLocalPage(page);
  for (const file of rootFiles) await verifyLocalRootFile(file);
  await verifyLocalSitemap();
  console.log("Local web library pages verified");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
