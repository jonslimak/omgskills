import productionFeatures from "../../config/production-features.json";
import { COMPANION_DEVICE_SCOPES, connectedInventoryDisclosure, normalPairingConsent,
  type PairingConsentPolicy } from "./browser-pairing";

export function productionConnectedProfile(href: string, publishableKey: unknown, features = productionFeatures) {
  const production = new URL(href).origin === "https://omgskills.com"
    && typeof publishableKey === "string" && publishableKey.startsWith("pk_live_")
    && features.skillGroupsWebEnabled === true && features.portalUnifiedEnabled === true;
  const inventory = production && features.connectedInventoryReadEnabled === true;
  return { inventory, sync: inventory && features.connectedInventorySyncEnabled === true };
}

export function productionInventoryConsent(enabled: boolean): PairingConsentPolicy {
  return {
    ...normalPairingConsent,
    parse: hash => enabled ? normalPairingConsent.parse(hash) : null,
    // content:read lets the companion download Sets shared with this account.
    // content:write (cloud save) only when the companion asks for it: older companions don't know it.
    scopes: request => request.scopes.includes("content:write")
      ? [...COMPANION_DEVICE_SCOPES, "content:write"]
      : COMPANION_DEVICE_SCOPES,
    disclosure: connectedInventoryDisclosure,
    approvalPath: "/api/portal/sync-pairing-code?inventory=3",
  };
}

export function inventoryConnectionRequest(search: string): "none" | "valid" | "invalid" {
  const params = new URLSearchParams(search);
  if (!params.has("inventory")) return "none";
  // Clerk may temporarily add its handshake while restoring the signed-in page.
  params.delete("__clerk_handshake");
  return params.toString() === "inventory=3" ? "valid" : "invalid";
}
