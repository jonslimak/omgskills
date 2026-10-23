import { isDiscovery, type Navigation } from "../../app/unified/model";

/** Clerk's `__client_uat` cookie (optionally suffixed) is "0" or absent when this browser has no session. */
export function likelySignedIn(cookie: string) {
  return /(?:^|;\s*)__client_uat(?:_[^=;]*)?=[1-9][0-9]*(?:;|$)/.test(cookie);
}

// Render public views before sign-in finishes loading (urls.md step 2), but only for
// browsers without a session: signed-in visitors keep the loading screen instead of a
// brief signed-out view, and private addresses always wait for sign-in.
export function renderPublicFirst(enabled: boolean, entry: Navigation, cookie: () => string) {
  return enabled && isDiscovery(entry.view) && !likelySignedIn(cookie());
}
