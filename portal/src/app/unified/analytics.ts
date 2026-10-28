import { isDiscovery, parseNavigation, parsePublicNavigationPath } from "./model";

// Only public production pages may load or use the automatic tracker.
type EventName = "App Search" | "App Skill Open" | "App Copy Install";
type Humblytics = { trackClickEvent?: (name: string) => void };
const trackerSource = "https://app.humblytics.com/hmbl.min.js?id=a156a68";
const trackerSelector = 'script[src="' + trackerSource + '"]';

function isPublicAnalyticsPage(hostname: string, pathname: string) {
  return (hostname === "omgskills.com" || hostname === "www.omgskills.com")
    && parsePublicNavigationPath(pathname.slice(1), "") !== null;
}

function isPublicAppPage(url: URL) {
  if (url.hostname !== "omgskills.com" && url.hostname !== "www.omgskills.com") return false;
  if (!url.pathname.startsWith("/app/")) return false;
  if (url.pathname !== "/app/") return parsePublicNavigationPath(url.pathname.slice("/app/".length), url.search) !== null;
  const params = url.searchParams;
  if ([...params.keys()].some(key => !["view", "id", "q", "skill", "source", "sort"].includes(key))) return false;
  const nav = parseNavigation(url.search);
  return params.get("view") === nav.view && isDiscovery(nav.view) && nav.source === "all"
    && (!nav.selected || nav.selected.startsWith("catalog:"));
}

export function startPublicAnalytics() {
  try {
    const { hostname, pathname } = window.location;
    if (!isPublicAnalyticsPage(hostname, pathname)
      || (window as { Humblytics?: Humblytics }).Humblytics
      || document.querySelector(trackerSelector)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = trackerSource;
    document.head.append(script);
  } catch { /* A blocked tracker must not break the public page. */ }
}

// A full navigation discards the SDK's automatic listeners before private UI loads.
export function needsAnalyticsDocumentReload(href: string) {
  if (window.location.hostname !== "omgskills.com" && window.location.hostname !== "www.omgskills.com") return false;
  const next = new URL(href, window.location.href);
  return !isPublicAnalyticsPage(next.hostname, next.pathname) && !isPublicAppPage(next)
    && !!document.querySelector(trackerSelector);
}

/** Sends the event once Humblytics has loaded (it loads async), giving up after ~5 seconds. */
export function trackEvent(name: EventName, attempts = 10) {
  try {
    const { hostname, pathname } = window.location;
    if (!isPublicAnalyticsPage(hostname, pathname)
      && !(isPublicAppPage(new URL(window.location.href)) && document.querySelector(trackerSelector))) return;
    const track = (window as { Humblytics?: Humblytics }).Humblytics?.trackClickEvent;
    if (track) track(name);
    else if (attempts > 1) setTimeout(() => trackEvent(name, attempts - 1), 500);
  } catch { /* Analytics never breaks the app. */ }
}
