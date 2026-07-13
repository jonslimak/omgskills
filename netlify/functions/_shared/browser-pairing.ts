import { isPairingCode } from "./crypto.js";

const BROWSER_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isBrowserPairingState(value: unknown): value is string {
  return typeof value === "string" && BROWSER_STATE_PATTERN.test(value);
}

export function browserPairingCallbackUrl(pairingCode: string, state: string) {
  if (!isPairingCode(pairingCode) || !isBrowserPairingState(state)) {
    throw new Error("Invalid browser pairing callback");
  }

  const callback = new URL("omgskills://pair");
  callback.searchParams.set("code", pairingCode);
  callback.searchParams.set("state", state);
  return callback.toString();
}
