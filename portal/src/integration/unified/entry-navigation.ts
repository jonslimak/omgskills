import { initialNavigation, parseNavigation, parsePublicNavigationPath, type Navigation } from "../../app/unified/model";
import { parseRoute } from "../../app/routes";

/** An address under the app that no view, legacy route or clean path recognizes. */
export function unknownAppAddress(pathname: string, base: string) {
  if (!pathname.startsWith(base)) return false;
  const relative = pathname.slice(base.length);
  return !!relative.replace(/\/$/, "") && !parsePublicNavigationPath(relative, "")
    && parseRoute(pathname, "", base).page === "missing";
}

/** A static page the app took over keeps its own address: the homepage or /library/...
 * (app.omgskills.com serves the app itself at "/", with base "/".) */
export function staticPageAddress(pathname: string, base: string) {
  return (pathname === "/" && base === "/app/") || pathname.startsWith("/library/");
}

// Keep previously shared /app/groups/:id links working in the unified shell.
export function entryNavigation(pathname: string, search: string, base: string): Navigation {
  // Clean public addresses are always readable, even where this entry still writes ?view=.
  const clean = pathname.startsWith(base) ? parsePublicNavigationPath(pathname.slice(base.length), search) : null;
  if (clean) return clean;
  // A static library page taken over by the app keeps its root /library/... address.
  const root = pathname.startsWith("/library/") ? parsePublicNavigationPath(pathname.slice(1), search) : null;
  if (root) return root;
  // The taken-over homepage is Discover.
  if (pathname === "/" && base === "/app/") return { ...initialNavigation, view: "discover" };
  const route = parseRoute(pathname, search, base);
  if (route.page === "detail") return { ...initialNavigation, view: "set", id: route.groupId! };
  if (route.page === "agents") return { ...initialNavigation, view: "agents" };
  if (route.page === "sets") return { ...initialNavigation, view: "sets" };
  if (route.page === "home") return { ...initialNavigation, view: "profile" };
  const params = new URLSearchParams(search);
  // Preserve older private links that did not include an explicit view.
  if (route.page === "skills" && !["view", "id", "q", "skill", "source", "sort"].some(key => params.has(key))) {
    return { ...initialNavigation, view: "discover" };
  }
  return parseNavigation(search);
}
