import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderLeaderboards } from "../site/data/leaderboards.js";

const start = "<!-- data:leaderboards:start -->";
const end = "<!-- data:leaderboards:end -->";

/** Puts the leaderboards between the page's markers, so search engines and slow browsers see them. */
export function replaceDataPageContent(html, content) {
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from < 0 || to <= from || html.indexOf(start, from + 1) !== -1 || html.indexOf(end, to + 1) !== -1) {
    throw new Error("Invalid data page markers");
  }
  return `${html.slice(0, from + start.length)}\n${content}\n    ${html.slice(to)}`;
}

/** Builds site/data/index.html (in the deploy copy) from the published v2 leaderboard data. */
export async function refreshDataPage({ siteDir }) {
  const dataDir = path.join(siteDir, "data", "v2");
  const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8"));
  const asset = manifest.leaderboardViewData?.path;
  if (!asset || path.basename(asset) !== asset || !/^leaderboard-view-data-[a-f0-9]+\.json$/.test(asset)) {
    throw new Error("Invalid leaderboard view asset in manifest");
  }
  const viewData = JSON.parse(await readFile(path.join(dataDir, asset), "utf8"));
  const file = path.join(siteDir, "data", "index.html");
  const html = await readFile(file, "utf8");
  await writeFile(file, replaceDataPageContent(html, renderLeaderboards(viewData, await readPublicSkillPaths(siteDir))));
}

// Written by the web library build; absent in a bare site checkout.
async function readPublicSkillPaths(siteDir) {
  try {
    const skills = JSON.parse(await readFile(path.join(siteDir, "catalog-skill-urls.json"), "utf8")).skills;
    return skills && typeof skills === "object" && !Array.isArray(skills) ? skills : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await refreshDataPage({ siteDir: path.resolve(process.argv[2] || "site") });
  console.log("Built the data page's leaderboards.");
}
