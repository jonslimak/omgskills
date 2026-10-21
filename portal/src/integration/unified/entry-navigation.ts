import { initialNavigation, parseNavigation, type Navigation } from "../../app/unified/model";
import { parseRoute } from "../../app/routes";

// Keep previously shared /app/groups/:id links working in the unified shell.
export function entryNavigation(pathname: string, search: string, base: string): Navigation {
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
