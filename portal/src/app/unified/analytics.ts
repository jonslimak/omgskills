// Reuse the tracker already present on public pages; never load it in /app/.
type EventName = "App Search" | "App Skill Open" | "App Copy Install";
type Humblytics = { trackClickEvent?: (name: string) => void };

/** Sends the event once Humblytics has loaded (it loads async), giving up after ~5 seconds. */
export function trackEvent(name: EventName, attempts = 10) {
  try {
    const { hostname, pathname } = window.location;
    if (hostname !== "omgskills.com" && hostname !== "www.omgskills.com") return;
    if (!/^(?:\/developers\/?$|\/library(?:\/|$))/.test(pathname) || /^\/library\/me(?:\/|$)/.test(pathname)) return;
    const track = (window as { Humblytics?: Humblytics }).Humblytics?.trackClickEvent;
    if (track) track(name);
    else if (attempts > 1) setTimeout(() => trackEvent(name, attempts - 1), 500);
  } catch { /* Analytics never breaks the app. */ }
}
