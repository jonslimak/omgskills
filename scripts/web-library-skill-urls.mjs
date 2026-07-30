import { createHash } from "node:crypto";

export const catalogSkillUrlsFilename = "catalog-skill-urls.json";
export const legacyCatalogSkillRedirects = [
  {
    path: "/skills/anthropics/skills/frontend-design/",
    catalogSkillId: "anthropics/skills:skills/frontend-design",
  },
];
const generatedSkillPathPattern = /^\/skills\/(?!\.)[a-z0-9._-]+(?:\/(?!\.)[a-z0-9._-]+)*\/$/;

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

export function skillPathForId(id) {
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

export function buildSkillUrlMap(skills) {
  const idsByBasePath = new Map();
  for (const skill of skills) {
    const basePath = skillPathForId(skill.id);
    const ids = idsByBasePath.get(basePath) || [];
    ids.push(skill.id);
    idsByBasePath.set(basePath, ids);
  }

  const urlById = new Map();
  const idByUrl = new Map();
  const register = (id, urlPath) => {
    if (urlById.has(id)) {
      throw new Error(`Duplicate catalog skill ID: ${id}`);
    }
    const previousId = idByUrl.get(urlPath);
    if (previousId) {
      throw new Error(`URL collision for ${urlPath}: ${previousId} and ${id}`);
    }
    urlById.set(id, urlPath);
    idByUrl.set(urlPath, id);
  };
  for (const [basePath, ids] of idsByBasePath) {
    if (ids.length === 1) {
      register(ids[0], basePath);
      continue;
    }

    for (const id of ids) {
      register(id, disambiguatedSkillPathForId(id));
    }
  }

  return urlById;
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
    if (!catalogSkillId.trim() || typeof urlPath !== "string" || !generatedSkillPathPattern.test(urlPath)) {
      throw new Error(`Catalog skill URL asset contains an invalid entry: ${catalogSkillId || "<missing>"}`);
    }
    return [catalogSkillId, urlPath];
  });
}
