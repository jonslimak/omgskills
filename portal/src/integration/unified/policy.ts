import { initialNavigation, isDiscovery, type Navigation } from "../../app/unified/model";

export const unifiedBase = "/app/integration/unified/";

export function accountNavigation(nav: Navigation, signedIn: boolean): Navigation {
  if (isDiscovery(nav.view)) {
    return { ...nav, source: "all", selected: nav.selected.startsWith("catalog:") ? nav.selected : "" };
  }
  if (!signedIn) return { ...initialNavigation, view: "discover" };
  if (!["all", "favorites", "sets", "set", "agents", "profile", "devices", "github", "mcp"].includes(nav.view)) return { ...initialNavigation };
  if (nav.view === "set" && !/^[a-zA-Z0-9_-]+$/.test(nav.id)) return { ...initialNavigation, view: "sets" };
  const list = ["all", "favorites", "set"].includes(nav.view);
  return { ...nav, id: nav.view === "set" ? nav.id : "",
    selected: list && (nav.selected.startsWith("synced:") || (nav.view !== "all" && nav.selected.startsWith("set-item:"))) ? nav.selected : "" };
}

// Private names/search terms must never be sent to the public search service.
export function publicNavigation(nav: Navigation): Navigation {
  return isDiscovery(nav.view) ? nav : { ...initialNavigation };
}
