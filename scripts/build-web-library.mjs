#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const origin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const maxAuthorSkills = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "3", 10);

const generatedDirs = ["skills", "profiles", "creators", "collections"];

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

function disambiguatedSkillPathForId(id) {
  const basePath = skillPathForId(id);
  const hash = createHash("sha256").update(String(id)).digest("hex").slice(0, 8);
  return basePath.replace(/\/$/, `--${hash}/`);
}

function profilePath(handle) {
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
    throw new Error(`URL collision for ${urlPath}: ${previousSource} and ${source}`);
  }
  urls.set(urlPath, source);
}

function buildSkillUrlMap(skills) {
  const idsByBasePath = new Map();
  for (const skill of skills) {
    const basePath = skillPathForId(skill.id);
    const ids = idsByBasePath.get(basePath) || [];
    ids.push(skill.id);
    idsByBasePath.set(basePath, ids);
  }

  const urls = new Map();
  const urlById = new Map();
  for (const [basePath, ids] of idsByBasePath) {
    if (ids.length === 1) {
      const id = ids[0];
      registerUrl(urls, basePath, `skill ${id}`);
      urlById.set(id, basePath);
      continue;
    }

    for (const id of ids) {
      const urlPath = disambiguatedSkillPathForId(id);
      registerUrl(urls, urlPath, `skill ${id}`);
      urlById.set(id, urlPath);
    }
  }

  return urlById;
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

function renderSkillPage(skill, repoSkills, authorSkills, skillUrlById) {
  const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
  const description = subtitleForSkill(skill).slice(0, 155);
  const about = aboutForSkill(skill);
  const installId = `install-${createHash("sha256").update(skill.id).digest("hex").slice(0, 10)}`;
  const body = `    <div class="eyebrow">Skill</div>
    <h1>${escapeHtml(skill.name)}</h1>
    <div class="meta">
      ${skill.author_handle ? `<a href="${escapeHtml(profilePath(skill.author_handle))}">@${escapeHtml(skill.author_handle)}</a>` : ""}
      <span>${compactNumber(skill.stars)} stars</span>
      ${skill.last_updated ? `<span>Updated ${escapeHtml(String(skill.last_updated).slice(0, 10))}</span>` : ""}
      ${authorConfidenceBadge(skill)}
    </div>
    ${about ? `<div class="section about"><div class="eyebrow">About</div><p>${escapeHtml(about)}</p></div>` : ""}
    <div class="section install-box">
      <div class="install-head"><span>Install command</span><button class="copy" type="button" data-copy="${escapeHtml(installId)}">Copy</button></div>
      <pre class="install"><code id="${escapeHtml(installId)}">${escapeHtml(skill.install_cmd || "")}</code></pre>
    </div>
    ${skill.github_url ? `<p><a href="${escapeHtml(skill.github_url)}">View on GitHub</a></p>` : ""}
    ${repoSkills.length ? `<div class="section"><div class="eyebrow">More from this repo</div><div class="grid">${skillCards(repoSkills, skillUrlById)}</div></div>` : ""}
    ${authorSkills.length ? `<div class="section"><div class="eyebrow">More skills</div><div class="grid">${skillCards(authorSkills, skillUrlById)}</div></div>` : ""}`;
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

function renderProfilePage(collection, skills, skillUrlById, authorStats) {
  const handle = collection.authorHandle;
  const urlPath = profilePath(handle);
  const description = collection.description || collection.subtitle || `Skills by @${handle}.`;
  const body = `    <img class="avatar" src="${escapeHtml(collection.imageUrl || `https://github.com/${handle}.png`)}" alt="">
    <div class="eyebrow">Profile</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta"><span>@${escapeHtml(handle)}</span><span>${skills.length} featured skills</span></div>
    ${profileStats(authorStats)}
    <div class="section"><div class="eyebrow">Featured skills</div><div class="grid">${skillCards(skills, skillUrlById)}</div></div>`;
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

function renderCollectionPage(collection, featuredSkills, allSkills, skillUrlById) {
  const urlPath = collectionPath(collection.id);
  const description = collection.description || collection.subtitle;
  const body = `    <div class="eyebrow">Collection</div>
    <h1>${escapeHtml(collection.title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta"><span>${allSkills.length} skills</span></div>
    <div class="section"><div class="eyebrow">Featured skills</div><div class="grid">${skillCards(featuredSkills, skillUrlById)}</div></div>
    ${allSkills.length > featuredSkills.length ? `<div class="section"><div class="eyebrow">Full collection</div><div class="grid">${skillCards(allSkills, skillUrlById)}</div></div>` : ""}`;
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

  const { skills, trending, collections, authorLeaderboards } = await loadLibraryData();
  const skillUrlById = buildSkillUrlMap(skills);

  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
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
    const urlPath = skillUrlById.get(skill.id) || skillPathForId(skill.id);
    registerUrl(urls, urlPath, `skill ${skill.id}`);
    const repoSkills = (skillsByRepo.get(repoKeyForSkill(skill)) || [])
      .filter((candidate) => candidate.id !== skill.id)
      .slice(0, 3);
    const repoSkillIds = new Set(repoSkills.map((candidate) => candidate.id));
    const authorSkills = uniqueSkills(skillsByAuthor.get(String(skill.author_handle || "").toLowerCase()) || [])
      .filter((candidate) => candidate.id !== skill.id && !repoSkillIds.has(candidate.id))
      .slice(0, Math.max(0, 3 - repoSkills.length));
    await writePage(urlPath, renderSkillPage(skill, repoSkills, authorSkills, skillUrlById));
  }

  for (const collection of collections.collections) {
    if (collection.type === "author" && collection.authorHandle) {
      const authorSkills = (skillsByAuthor.get(collection.authorHandle.toLowerCase()) || [])
        .filter((skill) => includedSkillIds.has(skill.id))
        .slice(0, 12);
      const urlPath = profilePath(collection.authorHandle);
      registerUrl(urls, urlPath, `profile ${collection.authorHandle}`);
      await writePage(
        urlPath,
        renderProfilePage(collection, authorSkills, skillUrlById, authorStatsByHandle.get(collection.authorHandle.toLowerCase())),
      );
    } else {
      const featuredSkills = (collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
      const allSkills = (collection.skillIds || collection.featuredSkillIds || []).map((id) => skillById.get(id)).filter(Boolean);
      const urlPath = collectionPath(collection.id);
      registerUrl(urls, urlPath, `collection ${collection.id}`);
      await writePage(urlPath, renderCollectionPage(collection, featuredSkills, allSkills, skillUrlById));
    }
  }

  await writeSitemaps(urls.keys());
  console.log(`Built web library test set: ${urls.size - 1} pages`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
