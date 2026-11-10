// Static-page takeover (urls.md step 2 pilot; move.md step 2 for every page). Switched on by
// the reviewed production setting takeoverPilotEnabled (config/production-features.json), or
// locally by PORTAL_TAKEOVER_PILOT=1; PORTAL_TAKEOVER_PILOT=0 forces it off. On its own it adds
// the app to /developers/, one creator page and one skill page; with takeoverAllPagesEnabled
// (PORTAL_TAKEOVER_ALL) to every creator page and every generated skill page at its /library/
// address. The homepage is the static landing page. With the switch off, the output is unchanged.
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalogSkillUrlsFilename } from "./web-library-skill-urls.mjs";

export const takeoverPilotEnabled = (env = process.env, features = {}) =>
  env.PORTAL_TAKEOVER_PILOT === "1" || (env.PORTAL_TAKEOVER_PILOT !== "0" && features.takeoverPilotEnabled === true);

// move.md step 2: every generated skill page also at its /library/ address, and every creator
// page, with the takeover. Needs the pilot on. PORTAL_TAKEOVER_ALL=1 / 0 overrides locally.
export const takeoverAllPagesEnabled = (env = process.env, features = {}) => takeoverPilotEnabled(env, features)
  && (env.PORTAL_TAKEOVER_ALL === "1" || (env.PORTAL_TAKEOVER_ALL !== "0" && features.takeoverAllPagesEnabled === true));

// Same mapping as the app's catalogSkillPath (portal/src/app/unified/model.ts); a portal test
// keeps the two in step. `owner/repo:skill/path` -> `/library/owner/repo/skill/path/`.
export const reservedLibraryNames = new Set(["trending", "companies", "creators", "collections", "data", "categories", "me", "library", "search"]);
export function librarySkillPath(id) {
  const segment = value => value && value !== "." && value !== ".." ? encodeURIComponent(value) : null;
  const colon = id.indexOf(":");
  const [owner = "", repo = "", ...extra] = (colon < 0 ? id : id.slice(0, colon)).split("/");
  const skill = colon < 0 ? [] : id.slice(colon + 1).split("/");
  if (extra.length || (colon >= 0 && !id.slice(colon + 1))) return null;
  const segments = [reservedLibraryNames.has(owner.toLowerCase()) ? null : segment(owner), segment(repo), ...skill.map(segment)];
  return segments.every(Boolean) ? `/library/${segments.join("/")}/` : null;
}

// Page URL -> static page it is built from. The skill page keeps its source's canonical
// (/skills/...) so the new address is not a competing duplicate during the pilot.
export const takeoverPilotPages = [
  { url: "/developers/", source: "/developers/" },
  { url: "/library/anthropics/", source: "/library/anthropics/" },
  { url: "/library/anthropics/skills/skills/frontend-design/", source: "/skills/anthropics/skills/skills/frontend-design/" },
];

// Keeps the app's CSS reset (Tailwind preflight) from moving the static page before the
// swap: unlayered, zero-specificity rules beat the layered reset but not the page's own.
export const takeoverGuardStyle = "html{line-height:normal;-webkit-text-size-adjust:auto;tab-size:8}"
  + ":where(h1,h2,h3,h4,h5,h6,b,strong,th){font-weight:revert}"
  + ":where(img,svg,video,canvas,audio,iframe,embed,object){display:revert;vertical-align:revert}";

/** The app shell's entry script and stylesheet tags, as built by Vite. */
export function appShellTags(appIndexHtml) {
  const tags = appIndexHtml.match(/<script type="module"[^>]*><\/script>|<link rel="stylesheet"[^>]*>/g) ?? [];
  if (!tags.some(tag => tag.startsWith("<script"))) throw new Error("Takeover pilot: app entry script not found");
  return tags;
}

/** Pages load the app through this fixed, uncached file, so an app release changes one file
 * instead of every page (deploys upload only changed files). */
export const takeoverLoaderPath = "/app/takeover.js";
// defer: runs after the page is parsed, so #root exists and first paint isn't blocked.
const loaderTag = `<script defer src="${takeoverLoaderPath}"></script>`;

/** Classic script that adds the current app's stylesheet and entry module to the page. */
export function takeoverLoader(tags) {
  const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  const scripts = tags.filter(tag => tag.startsWith("<script")).map(tag => attribute(tag, "src"));
  const styles = tags.filter(tag => tag.startsWith("<link")).map(tag => attribute(tag, "href"));
  if (!scripts.length || [...scripts, ...styles].some(url => !url?.startsWith("/app/assets/"))) {
    throw new Error("Takeover: unexpected app shell tags");
  }
  return `// Generated at build: loads the current app into a static library page.
(function () {
  var head = document.head;
  ${JSON.stringify(styles)}.forEach(function (href) {
    var link = document.createElement("link"); link.rel = "stylesheet"; link.crossOrigin = ""; link.href = href; head.appendChild(link);
  });
  ${JSON.stringify(scripts)}.forEach(function (src) {
    var script = document.createElement("script"); script.type = "module"; script.crossOrigin = ""; script.src = src; head.appendChild(script);
  });
})();
`;
}

/**
 * Static content goes into #omgskills-static and the app renders into a hidden #root.
 * The page's own styles are marked so the app removes them on swap.
 */
export function addTakeover(pageHtml, tags = [loaderTag]) {
  if (pageHtml.includes('id="omgskills-static"')) throw new Error("Takeover pilot: page already converted");
  const headEnd = pageHtml.indexOf("</head>");
  const bodyStart = pageHtml.indexOf("<body>");
  const bodyEnd = pageHtml.lastIndexOf("</body>");
  if (headEnd < 0 || bodyStart < headEnd || bodyEnd < bodyStart) throw new Error("Takeover pilot: unexpected page structure");
  const head = pageHtml.slice(0, headEnd).replace(/<style>/g, "<style data-omgskills-static>");
  const body = pageHtml.slice(bodyStart + "<body>".length, bodyEnd);
  return `${head}  <style data-omgskills-static>${takeoverGuardStyle}</style>\n  ${tags.join("\n  ")}\n</head>\n<body>`
    + `\n<div id="omgskills-static">${body}</div>\n<div id="root" hidden></div>\n${pageHtml.slice(bodyEnd)}`;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/**
 * Every generated skill page also at its /library/ address (canonical stays /skills/...), plus
 * every creator page and /developers/ in place. Addresses that differ only by case are written
 * once (the first in catalog order) so the output is the same on case-insensitive disks.
 */
export async function takeoverAllPages(outputDir) {
  const pages = [{ url: "/developers/", source: "/developers/" }];
  const library = path.join(outputDir, "library");
  for (const entry of await readdir(library, { withFileTypes: true })) {
    if (entry.isDirectory() && await exists(path.join(library, entry.name, "index.html"))) {
      pages.push({ url: `/library/${entry.name}/`, source: `/library/${entry.name}/` });
    }
  }
  const { skills } = JSON.parse(await readFile(path.join(outputDir, catalogSkillUrlsFilename), "utf8"));
  const taken = new Set(pages.map(page => page.url.toLowerCase()));
  const skipped = [];
  for (const [id, source] of Object.entries(skills)) {
    const url = librarySkillPath(id);
    // Disk paths are decoded; a creator page already lives at /library/<owner>/ (no skill part).
    const file = url && decodeURIComponent(url);
    // Netlify's deploy drops files and folders whose names start with "." (e.g. .claude/), so
    // those skills keep only their /skills/ page until the app has a dot-safe address (move.md step 3).
    if (!url || file.split("/").some(part => part.startsWith(".")) || taken.has(file.toLowerCase())) { skipped.push(id); continue; }
    taken.add(file.toLowerCase());
    pages.push({ url: file, source });
  }
  return { pages, skipped };
}

export async function writeTakeover(outputDir, { all = false } = {}) {
  const tags = appShellTags(await readFile(path.join(outputDir, "app", "index.html"), "utf8"));
  await writeFile(path.join(outputDir, takeoverLoaderPath), takeoverLoader(tags));
  const { pages, skipped } = all ? await takeoverAllPages(outputDir) : { pages: takeoverPilotPages, skipped: [] };
  for (const page of pages) {
    const source = await readFile(path.join(outputDir, page.source, "index.html"), "utf8");
    const target = path.join(outputDir, page.url, "index.html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, addTakeover(source));
  }
  return { urls: pages.map(page => page.url), skipped };
}

/** The three pilot pages only (kept for the pilot setting on its own). */
export async function writeTakeoverPilot(outputDir) {
  return (await writeTakeover(outputDir)).urls;
}
