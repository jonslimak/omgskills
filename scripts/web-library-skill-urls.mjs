import { createHash } from "node:crypto";

export const catalogSkillUrlsFilename = "catalog-skill-urls.json";
// Old addresses kept working: path -> the skill's current page (move.md step 3 adds a 301 for
// every generated /skills/ page on top of these).
export const legacyCatalogSkillRedirects = [
  {
    path: "/skills/anthropics/skills/frontend-design/",
    catalogSkillId: "anthropics/skills:skills/frontend-design",
  },
];

// Same mapping as the app's catalogSkillPath (portal/src/app/unified/model.ts); a portal test
// keeps the two in step. `owner/repo:skill/path` -> `/library/owner/repo/skill/path/`.
export const reservedLibraryNames = new Set(["trending", "companies", "creators", "collections", "data", "categories", "me", "library", "search"]);
export function librarySkillPath(id) {
  const segment = value => value && value !== "." && value !== ".." ? encodeURIComponent(value) : null;
  // Repo and skill-path parts: ".x" -> "dot-x", "dot-x" -> "dot-dot-x" (hosting drops dot-named folders).
  const dotSafe = value => value.startsWith(".dot-") || value === "." || value === ".." ? null
    : segment(value.startsWith(".") ? `dot-${value.slice(1)}` : value.startsWith("dot-") ? `dot-${value}` : value);
  const colon = id.indexOf(":");
  const [owner = "", repo = "", ...extra] = (colon < 0 ? id : id.slice(0, colon)).split("/");
  const skill = colon < 0 ? [] : id.slice(colon + 1).split("/");
  if (extra.length || (colon >= 0 && !id.slice(colon + 1))) return null;
  const segments = [reservedLibraryNames.has(owner.toLowerCase()) ? null : segment(owner), dotSafe(repo), ...skill.map(dotSafe)];
  return segments.every(Boolean) ? `/library/${segments.join("/")}/` : null;
}

/**
 * A skill's public page (move.md step 3): its /library/ address in lower case, which is the form
 * hosting serves (Netlify 301s /library/AgriciDaniel/... to /library/agricidaniel/...). The app
 * opens both. Null when the ID has no library address.
 */
export function skillPathForId(id) {
  return librarySkillPath(String(id).toLowerCase());
}

/** Disk path for a page URL (segments like %3A are written decoded, as hosting serves them). */
export function urlPathToFilePath(urlPath) {
  return decodeURIComponent(urlPath);
}

const generatedSkillPathPattern = /^\/library\/(?:(?:[a-z0-9._~!'()*-]|%[0-9A-F]{2})+\/){2,}$/;

function slugSegment(value) {
  let slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const leadingDots = slug.match(/^\.+/)?.[0];
  if (leadingDots) {
    const remainder = slug.slice(leadingDots.length).replace(/^-+/, "");
    const dotPrefix = Array.from(leadingDots, () => "dot").join("-");
    slug = remainder ? `${dotPrefix}-${remainder}` : dotPrefix;
  }

  return slug || "item";
}

/** The address a skill's page had before move.md step 3 (now a 301 to skillPathForId). */
export function legacySkillPathForId(id) {
  const [repoPart, skillPart] = String(id).split(":");
  const repoSegments = repoPart.split("/").map(slugSegment);
  const skillSegments = skillPart ? skillPart.split("/").map(slugSegment) : [];
  return `/skills/${[...repoSegments, ...skillSegments].join("/")}/`;
}

function disambiguatedLegacySkillPathForId(id) {
  const basePath = legacySkillPathForId(id);
  const hash = createHash("sha256").update(String(id)).digest("hex").slice(0, 8);
  return basePath.replace(/\/$/, `--${hash}/`);
}

/**
 * Each skill's old /skills/ address, exactly as the old build gave it (IDs whose slugs collided
 * got a hash suffix), so every old page can 301 to its new one.
 */
export function buildLegacySkillUrlMap(skills) {
  const idsByBasePath = new Map();
  for (const skill of skills) {
    const basePath = legacySkillPathForId(skill.id);
    const ids = idsByBasePath.get(basePath) || [];
    ids.push(skill.id);
    idsByBasePath.set(basePath, ids);
  }

  const urlById = new Map();
  for (const [basePath, ids] of idsByBasePath) {
    for (const id of ids) {
      if (urlById.has(id)) throw new Error(`Duplicate catalog skill ID: ${id}`);
      urlById.set(id, ids.length === 1 ? basePath : disambiguatedLegacySkillPathForId(id));
    }
  }
  return urlById;
}

/**
 * Each skill's page address. A skill with no library address, or whose address another skill
 * already has (IDs that differ only by case), gets no page: the first in catalog order keeps it.
 */
export function buildSkillUrlMap(skills) {
  const urlById = new Map();
  const idByUrl = new Map();
  for (const skill of skills) {
    if (urlById.has(skill.id)) throw new Error(`Duplicate catalog skill ID: ${skill.id}`);
    const urlPath = skillPathForId(skill.id);
    if (!urlPath || urlPathToFilePath(urlPath).split("/").some(part => part.startsWith(".")) || idByUrl.has(urlPath)) continue;
    urlById.set(skill.id, urlPath);
    idByUrl.set(urlPath, skill.id);
  }
  return urlById;
}

/**
 * Redirect rules: each old /skills/ page (and its Markdown copy) -> the skill's page. A skill
 * that lost its page to a case twin redirects to the twin's page.
 */
export function legacySkillRedirectLines(generatedUrlById, legacyUrlById) {
  const generatedUrls = new Set(generatedUrlById.values());
  const lines = [];
  for (const [id, legacyPath] of legacyUrlById) {
    const urlPath = generatedUrlById.get(id) ?? (generatedUrls.has(skillPathForId(id)) ? skillPathForId(id) : null);
    // The catch-all /skills/* -> /library/:splat covers pages whose address only changed prefix.
    if (!urlPath || legacyPath.replace(/^\/skills\//, "/library/") === urlPath) continue;
    lines.push(`${legacyPath}  ${urlPath}  301`, `${legacyPath}index.md  ${urlPath}index.md  301`);
  }
  return lines;
}

export function buildCatalogSkillUrlsAsset(generatedUrlById) {
  return {
    version: 1,
    skills: Object.fromEntries(
      [...generatedUrlById.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function catalogSkillUrlEntries(asset) {
  if (
    !asset ||
    Array.isArray(asset) ||
    typeof asset !== "object" ||
    asset.version !== 1 ||
    !asset.skills ||
    Array.isArray(asset.skills) ||
    typeof asset.skills !== "object"
  ) {
    throw new Error("Catalog skill URL asset has an invalid shape");
  }

  return Object.entries(asset.skills).map(([catalogSkillId, urlPath]) => {
    if (!catalogSkillId.trim() || typeof urlPath !== "string" || !generatedSkillPathPattern.test(urlPath) || urlPath.includes("/.")) {
      throw new Error(`Catalog skill URL asset contains an invalid entry: ${catalogSkillId || "<missing>"}`);
    }
    return [catalogSkillId, urlPath];
  });
}
