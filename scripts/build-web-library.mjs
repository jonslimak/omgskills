#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const maxAuthorSkills = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "3", 10);

const generatedDirs = ["skills", "creators", "collections"];

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

function skillPathForId(id) {
  const [repoPart, skillPart] = String(id).split(":");
  const repoSegments = repoPart.split("/").map(slugSegment);
  const skillSegments = skillPart ? skillPart.split("/").map(slugSegment) : [];
  return `/skills/${[...repoSegments, ...skillSegments].join("/")}/`;
}

function creatorPath(handle) {
  return `/creators/${slugSegment(handle)}/`;
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
    throw new Error(`URL collision for ${urlPath}: ${previousSource} and ${source}`);
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
  return skill.description || skill.readme_snippet || `Install ${skill.name} from ${skill.author_handle || "the omgskills catalog"}.`;
}

function pageShell({ title, description, path: urlPath, body, structuredData }) {
  const canonical = `${origin}${urlPath}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <style>
    :root { color-scheme: light; --text: #111111; --muted: #6b7280; --line: #e5e7eb; --soft: #f7f7f8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: #ffffff; }
    header, main { max-width: 880px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; }
    a { color: inherit; }
    .brand { font-size: 13px; font-weight: 700; text-decoration: none; }
    .cta { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; text-decoration: none; font-size: 13px; }
    .eyebrow { color: var(--muted); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    h1 { font-size: clamp(34px, 7vw, 64px); line-height: .95; margin: 12px 0 16px; letter-spacing: -0.04em; }
    p { color: var(--muted); line-height: 1.55; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; color: var(--muted); font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 24px; }
    .card { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 16px; text-decoration: none; background: #fff; }
    .card:hover { background: var(--soft); }
    .card h2 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.02em; }
    .card p { margin: 0; font-size: 14px; }
    .avatar { width: 72px; height: 72px; border-radius: 14px; vertical-align: middle; background: var(--soft); }
    .install { overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--soft); font-size: 13px; }
    .section { margin-top: 36px; }
  </style>
  <script type="application/ld+json">${jsonScript(structuredData)}</script>
</head>
<body>
  <header>
    <a class="brand" href="/">omgskills</a>
    <a class="cta" href="/">Get the Mac app</a>
  </header>
  <main>
${body}
  </main>
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
  };
}

async function loadLibraryData() {
  try {
    return await readAssetFromManifest("crawl4");
  } catch (error) {
    console.warn(`build-web-library: Crawl 4 unavailable (${error.message}); falling back to v2`);
    return readAssetFromManifest("v2");
  }
}

async function writePage(urlPath, html) {
  const filePath = path.join(siteDir, urlPath.replace(/^\/+/, ""), "index.html");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, html);
}

function skillCards(skills) {
  return skills.map((skill) => {
    const href = skillPathForId(skill.id);
    return `<a class="card" href="${escapeHtml(href)}">
      <h2>${escapeHtml(skill.name)}</h2>
      <p>${escapeHtml(descriptionForSkill(skill))}</p>
      <div class="meta"><span>${compactNumber(skill.stars)} stars</span>${skill.author_handle ? `<span>@${escapeHtml(skill.author_handle)}</span>` : ""}</div>
    </a>`;
  }).join("\n");
}

function renderSkillPage(skill, relatedSkills) {
  const urlPath = skillPathForId(skill.id);
  const description = descriptionForSkill(skill).slice(0, 155);
  const body = `    <div class="eyebrow">Skill</div>
    <h1>${escapeHtml(skill.name)}</h1>
    <p>${escapeHtml(descriptionForSkill(skill))}</p>
    <div class="meta">
      ${skill.author_handle ? `<a href="${escapeHtml(creatorPath(skill.author_handle))}">@${escapeHtml(skill.author_handle)}</a>` : ""}
      <span>${compactNumber(skill.stars)} stars</span>
      ${skill.last_updated ? `<span>Updated ${escapeHtml(String(skill.last_updated).slice(0, 10))}</span>` : ""}
    </div>
    <pre class="install"><code>${escapeHtml(skill.install_cmd || "")}</code></pre>
    ${skill.github_url ? `<p><a href="${escapeHtml(skill.github_url)}">View on GitHub</a></p>` : ""}
    ${relatedSkills.length ? `<div class="section"><div class="eyebrow">More by this creator</div><div class="grid">${skillCards(relatedSkills)}</div></div>` : ""}`;
  return pageShell({
    title: `${skill.name} skill - omgskills`,
    description,
    path: urlPath,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: skill.name,
      description,
      url: `${origin}${urlPath}`,
      applicationCategory: "DeveloperApplication",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  });
}

function renderCreatorPage(collection, skills) {
  const handle = collection.authorHandle;
  const urlPath = creatorPath(handle);
  const description = collection.description || collection.subtitle || `Skills by @${handle}.`;
  const body = `    <img class="avatar" src="${escapeHtml(collection.imageUrl || `https://github.com/${handle}.png`)}" alt="">
    <div class="eyebrow">Creator</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta"><span>@${escapeHtml(handle)}</span><span>${skills.length} featured skills</span></div>
    <div class="section"><div class="eyebrow">Featured skills</div><div class="grid">${skillCards(skills)}</div></div>`;
  return pageShell({
    title: `${collection.title} skills - omgskills`,
    description,
    path: urlPath,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: collection.title,
      url: `${origin}${urlPath}`,
      image: collection.imageUrl || `https://github.com/${handle}.png`,
    },
  });
}

function renderCollectionPage(collection, featuredSkills, allSkills) {
  const urlPath = collectionPath(collection.id);
  const description = collection.description || collection.subtitle;
  const body = `    <div class="eyebrow">Collection</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta"><span>${allSkills.length} skills</span></div>
    <div class="section"><div class="eyebrow">Featured skills</div><div class="grid">${skillCards(featuredSkills)}</div></div>
    ${allSkills.length > featuredSkills.length ? `<div class="section"><div class="eyebrow">Full collection</div><div class="grid">${skillCards(allSkills)}</div></div>` : ""}`;
  return pageShell({
    title: `${collection.title} - omgskills`,
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
  });
}

async function writeSitemaps(urls) {
  const sortedUrls = [...urls].sort();
  const urlset = sortedUrls
    .map((urlPath) => `  <url><loc>${escapeHtml(`${origin}${urlPath}`)}</loc></url>`)
    .join("\n");
  await writeFile(
    path.join(siteDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`,
  );
}

async function main() {
  for (const dir of generatedDirs) {
    await rm(path.join(siteDir, dir), { recursive: true, force: true });
  }
  await rm(path.join(siteDir, "sitemap.xml"), { force: true });

  const { skills, trending, collections } = await loadLibraryData();
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const skillsByAuthor = new Map();
  for (const skill of skills) {
    const handle = String(skill.author_handle || "").toLowerCase();
    if (!handle) continue;
    const list = skillsByAuthor.get(handle) || [];
    list.push(skill);
    skillsByAuthor.set(handle, list);
  }
  for (const list of skillsByAuthor.values()) {
    list.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
  }

  const includedSkillIds = new Set();
  for (const collection of collections.collections) {
    for (const id of collection.featuredSkillIds || []) includedSkillIds.add(id);
    for (const id of collection.skillIds || []) includedSkillIds.add(id);
    if (collection.type === "author" && collection.authorHandle) {
      for (const skill of (skillsByAuthor.get(collection.authorHandle.toLowerCase()) || []).slice(0, maxAuthorSkills)) {
        includedSkillIds.add(skill.id);
      }
    }
  }
  for (const entry of trending.slice(0, 25)) {
    if (entry.id) includedSkillIds.add(entry.id);
  }

  const urls = new Map([["/", "home"]]);
  for (const id of includedSkillIds) {
    const skill = skillById.get(id);
    if (!skill) continue;
    const urlPath = skillPathForId(skill.id);
    registerUrl(urls, urlPath, `skill ${skill.id}`);
    const related = (skillsByAuthor.get(String(skill.author_handle || "").toLowerCase()) || [])
      .filter((candidate) => candidate.id !== skill.id)
      .slice(0, 3);
    await writePage(urlPath, renderSkillPage(skill, related));
  }

  for (const collection of collections.collections) {
    if (collection.type === "author" && collection.authorHandle) {
      const authorSkills = (skillsByAuthor.get(collection.authorHandle.toLowerCase()) || [])
        .filter((skill) => includedSkillIds.has(skill.id))
        .slice(0, 12);
      const urlPath = creatorPath(collection.authorHandle);
      registerUrl(urls, urlPath, `creator ${collection.authorHandle}`);
      await writePage(urlPath, renderCreatorPage(collection, authorSkills));
    } else {
      const featuredSkills = (collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
      const allSkills = (collection.skillIds || collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
      const urlPath = collectionPath(collection.id);
      registerUrl(urls, urlPath, `collection ${collection.id}`);
      await writePage(urlPath, renderCollectionPage(collection, featuredSkills, allSkills));
    }
  }

  await writeSitemaps(urls.keys());
  console.log(`Built web library test set: ${urls.size - 1} pages`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
