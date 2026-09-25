// Only accept the existing server-issued group protocol, never an arbitrary href.
export function setInstallLink(value: unknown, enabled: boolean, local: boolean): string | null {
  if (!enabled || local || typeof value !== "string") return null;
  try {
    const link = new URL(value);
    if (link.protocol !== "omgskills:" || link.hostname !== "group" || link.username || link.password ||
      link.port || link.pathname || link.hash || [...link.searchParams.keys()].join() !== "url") return null;
    const target = new URL(link.searchParams.get("url") || "");
    if (target.origin !== "https://omgskills.com" || target.username || target.password || target.search || target.hash ||
      !/^\/u\/[a-z0-9][a-z0-9-]*\/sets\/[a-z0-9][a-z0-9-]*\/?$/.test(target.pathname)) return null;
    return value;
  } catch { return null; }
}
