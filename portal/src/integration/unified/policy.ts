import { initialNavigation, isDiscovery, type Navigation } from "../../app/unified/model";

export const unifiedBase = "/app/integration/unified/";

export function accountNavigation(nav: Navigation, signedIn: boolean): Navigation {
  if (isDiscovery(nav.view)) {
    return { ...nav, source: "all", selected: nav.selected.startsWith("catalog:") ? nav.selected : "" };
  }
  if (!signedIn) return { ...initialNavigation, view: "discover" };
  if (!["all", "agents", "profile"].includes(nav.view)) return { ...initialNavigation };
  return { ...nav, selected: nav.view === "all" && nav.selected.startsWith("synced:") ? nav.selected : "" };
}

// Private names/search terms must never be sent to the public search service.
export function publicNavigation(nav: Navigation): Navigation {
  return isDiscovery(nav.view) ? nav : { ...initialNavigation };
}
