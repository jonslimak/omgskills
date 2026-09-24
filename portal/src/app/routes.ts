export type Page = "skills" | "agents" | "sets" | "detail" | "home" | "missing";
export type Route = { page: Page; groupId?: string; source: string };

export function parseRoute(path: string, search: string, base: string): Route {
  const source = new URLSearchParams(search).get("source") || "all";
  const relative =
    path === base.replace(/\/$/, "")
      ? ""
      : path.startsWith(base)
        ? path.slice(base.length).replace(/\/$/, "")
        : null;
  if (relative === "") return { page: "skills", source };
  if (relative === "agents" || relative === "sets" || relative === "home")
    return { page: relative, source };
  if (relative?.match(/^groups\/[^/]+$/)) {
    try {
      return {
        page: "detail",
        groupId: decodeURIComponent(relative.slice(7)),
        source,
      };
    } catch {
      return { page: "missing", source };
    }
  }
  return { page: "missing", source };
}
