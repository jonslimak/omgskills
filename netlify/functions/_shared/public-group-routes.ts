export const PUBLIC_SITE_ORIGIN = "https://omgskills.com";

export type PublicPageRoute =
  | { kind: "profile"; handle: string; canonicalPath: string }
  | { kind: "group"; handle: string; groupSlug: string; canonicalPath: string };

export type PublicManifestRoute = {
  handle: string;
  groupSlug: string;
};

function isValidSegment(value: string): boolean {
  return value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

export function publicProfilePath(handle: string): string {
  return `/u/${handle.toLowerCase()}`;
}

export function publicGroupPath(handle: string, groupSlug: string): string {
  return `${publicProfilePath(handle)}/sets/${groupSlug.toLowerCase()}`;
}

export function publicGroupUrl(handle: string, groupSlug: string): string {
  return `${PUBLIC_SITE_ORIGIN}${publicGroupPath(handle, groupSlug)}`;
}

// Reserved for L5.2. Do not render this link until the app can preview and install groups.
export function publicGroupAppDeepLink(handle: string, groupSlug: string): string {
  const link = new URL("omgskills://group");
  link.searchParams.set("url", publicGroupUrl(handle, groupSlug));
  return link.toString();
}

export function parsePublicPageRoute(pathname: string): PublicPageRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  const handle = parts[1]?.toLowerCase();
  if (!handle || !isValidSegment(handle)) {
    return null;
  }

  if ((parts[0] === "u" || parts[0] === "profiles") && parts.length === 2) {
    return { kind: "profile", handle, canonicalPath: publicProfilePath(handle) };
  }

  let groupSlug: string | null = null;
  if (
    (parts[0] === "u" || parts[0] === "profiles") &&
    parts[2] === "sets" &&
    parts[3] &&
    parts.length === 4
  ) {
    groupSlug = parts[3].toLowerCase();
  } else if (
    parts[0] === "u" &&
    parts[2] &&
    parts[2].toLowerCase() !== "sets" &&
    parts.length === 3
  ) {
    groupSlug = parts[2].toLowerCase();
  }

  if (!groupSlug || !isValidSegment(groupSlug)) {
    return null;
  }
  return {
    kind: "group",
    handle,
    groupSlug,
    canonicalPath: publicGroupPath(handle, groupSlug),
  };
}

export function parsePublicManifestRoute(pathname: string): PublicManifestRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length !== 6
    || parts[0] !== "api"
    || parts[1] !== "public"
    || parts[2] !== "groups"
    || parts[5] !== "manifest"
  ) {
    return null;
  }
  const handle = parts[3].toLowerCase();
  const groupSlug = parts[4].toLowerCase();
  if (!isValidSegment(handle) || !isValidSegment(groupSlug)) {
    return null;
  }
  return { handle, groupSlug };
}

export function publicGroupsSitemapXml(
  groups: Array<{ handle: string; groupSlug: string }>
): string {
  const entries = groups
    .map(({ handle, groupSlug }) => publicGroupUrl(handle, groupSlug))
    .sort((left, right) => left.localeCompare(right))
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
