import { BASE_DEVICE_SCOPES, connectedInventoryDisclosure, isBrowserPairingApproval,
  normalPairingConsent, parseBrowserPairingRequest, type PairingConsentPolicy } from "../browser-pairing";
import { initialNavigation, isDiscovery, type Navigation } from "../app/unified/model";
import { accountNavigation } from "../integration/unified/policy";
import type { PortalApi } from "../portal-api";
import { candidateOrigin } from "./policy";

export { candidateOrigin as connectedCandidateOrigin };

export const connectedCandidateConsent: PairingConsentPolicy = {
  ...normalPairingConsent,
  parse(hash) {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    if ([...params.keys()].some(key => !["state", "code_challenge", "scope"].includes(key))) return null;
    return parseBrowserPairingRequest(hash);
  },
  scopes: () => BASE_DEVICE_SCOPES,
  disclosure: connectedInventoryDisclosure,
};

export function connectedClerkFrontend(publishableKey: unknown): string {
  try {
    if (typeof publishableKey !== "string" || !/^pk_test_[A-Za-z0-9+/]+={0,2}$/.test(publishableKey)) throw Error();
    const decoded = atob(publishableKey.slice(8));
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.clerk\.accounts\.dev\$$/.test(decoded)) throw Error();
    return `https://${decoded.slice(0, -1)}`;
  } catch { throw new Error("A valid Clerk development publishable key is required."); }
}

export function connectedCandidateReturnUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== candidateOrigin || url.username || url.password) return null;
    if (url.pathname === "/app/connect") {
      return !url.search && connectedCandidateConsent.parse(url.hash) ? url.href : null;
    }
    if (url.pathname !== "/app/" || url.hash) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key, index) => !["view", "id", "q", "skill", "source"].includes(key) || keys.indexOf(key) !== index)) return null;
    return url.href;
  } catch { return null; }
}

// Let Clerk consume its callback; never retain the opaque value in an app return link.
function connectedCandidateBootstrapUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const handshake = url.searchParams.getAll("__clerk_handshake");
    if (!handshake.length) return connectedCandidateReturnUrl(value);
    if (handshake.length !== 1 || !handshake[0]) return null;
    url.searchParams.delete("__clerk_handshake");
    return connectedCandidateReturnUrl(url.href);
  } catch { return null; }
}

export function requireConnectedCandidateBrowser(input: {
  profile: unknown; publishableKey: unknown; clerkFrontendOrigin: unknown;
}, href: string) {
  const returnUrl = connectedCandidateBootstrapUrl(href);
  if (input.profile !== "connected" || !returnUrl) throw new Error("Connected candidate is unavailable.");
  const clerkFrontendOrigin = connectedClerkFrontend(input.publishableKey);
  if (input.clerkFrontendOrigin !== clerkFrontendOrigin) throw new Error("Connected candidate sign-in configuration is invalid.");
  return { publishableKey: input.publishableKey as string, clerkFrontendOrigin, returnUrl,
    route: new URL(returnUrl).pathname === "/app/connect" ? "connect" as const : "app" as const };
}

export function connectedCandidateNavigation(nav: Navigation, signedIn: boolean): Navigation {
  return accountNavigation(!isDiscovery(nav.view) && !["all", "agents", "devices", "profile"].includes(nav.view)
    ? { ...initialNavigation, view: "discover" } : nav, signedIn);
}

const readPaths = ["/api/portal/synced-skills?version=3", "/api/portal/devices",
  "/api/portal/profile", "/api/portal/groups", "/api/portal/shared"];
const groupPath = /^\/api\/portal\/groups\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isConnectedCandidateBrowserRequest(path: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (method === "GET") return init.body == null && (readPaths.includes(path) || groupPath.test(path));
  if (method !== "POST" || path !== "/api/portal/sync-pairing-code" || typeof init.body !== "string") return false;
  try {
    const body = JSON.parse(init.body);
    return body !== null && typeof body === "object" && !Array.isArray(body) && isBrowserPairingApproval(body)
      && body.scopes.length === 2 && BASE_DEVICE_SCOPES.every(scope => body.scopes.includes(scope));
  } catch { return false; }
}

export function connectedCandidateBrowserApi(api: PortalApi): PortalApi {
  return (path, init = {}) => isConnectedCandidateBrowserRequest(path, init)
    ? api(path, { ...init, redirect: "error", cache: "no-store" })
    : Promise.reject(new Error("This action is unavailable in the connected candidate."));
}
