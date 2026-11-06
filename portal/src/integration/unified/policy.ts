import { initialNavigation, isDiscovery, type Navigation } from "../../app/unified/model";

export const unifiedBase = "/app/integration/unified/";

export function accountNavigation(nav: Navigation, signedIn: boolean): Navigation {
  if (isDiscovery(nav.view)) {
    const personalResult = signedIn && !!nav.query.trim() && personalKey(nav.selected);
    return { ...nav, source: "all", selected: nav.selected.startsWith("catalog:") || personalResult ? nav.selected : "" };
  }
  if (!signedIn) return { ...initialNavigation, view: "discover" };
  if (!["all", "favorites", "sets", "set", "agents", "profile", "devices", "github", "cloud", "mcp"].includes(nav.view)) return { ...initialNavigation };
  if (nav.view === "set" && !/^[a-zA-Z0-9_-]+$/.test(nav.id)) return { ...initialNavigation, view: "sets" };
  const list = ["all", "favorites", "set"].includes(nav.view);
  // "attention" is the only list filter My skills keeps in the address.
  // A Not installed skill is a My skills row, or a search result anywhere that lists your skills.
  const notInstalled = personalKey(nav.selected) && !nav.selected.startsWith("synced:") && (nav.view === "all" || !!nav.query.trim());
  return { ...nav, id: nav.view === "set" || (nav.view === "all" && nav.id === "attention") ? nav.id : "",
    selected: list && (nav.selected.startsWith("synced:") || notInstalled
      || (nav.view !== "all" && nav.selected.startsWith("set-item:"))) ? nav.selected : "" };
}

/** Rows from My skills: installed (synced:), or kept only in your account (cloud:, added:). */
function personalKey(selected: string) {
  return selected.startsWith("synced:") || selected.startsWith("cloud:") || selected.startsWith("added:");
}

// Private names/search terms must never be sent to the public search service.
export function publicNavigation(nav: Navigation): Navigation {
  return isDiscovery(nav.view)
    ? { ...nav, selected: nav.selected.startsWith("catalog:") ? nav.selected : "" }
    : { ...initialNavigation };
}
