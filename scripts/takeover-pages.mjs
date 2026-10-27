// Static-page takeover pilot (urls.md step 2, item 3). Switched on by the reviewed
// production setting takeoverPilotEnabled (config/production-features.json), or locally
// by PORTAL_TAKEOVER_PILOT=1; PORTAL_TAKEOVER_PILOT=0 forces it off. It adds the app to
// /developers/, one creator page and one skill page. The homepage is the static landing page. With the
// switch off, the build output is unchanged.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const takeoverPilotEnabled = (env = process.env, features = {}) =>
  env.PORTAL_TAKEOVER_PILOT === "1" || (env.PORTAL_TAKEOVER_PILOT !== "0" && features.takeoverPilotEnabled === true);

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

/**
 * Static content goes into #omgskills-static and the app renders into a hidden #root.
 * The page's own styles are marked so the app removes them on swap.
 */
export function addTakeover(pageHtml, tags) {
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

export async function writeTakeoverPilot(outputDir) {
  const tags = appShellTags(await readFile(path.join(outputDir, "app", "index.html"), "utf8"));
  for (const page of takeoverPilotPages) {
    const source = await readFile(path.join(outputDir, page.source, "index.html"), "utf8");
    const target = path.join(outputDir, page.url, "index.html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, addTakeover(source, tags));
  }
  return takeoverPilotPages.map(page => page.url);
}
