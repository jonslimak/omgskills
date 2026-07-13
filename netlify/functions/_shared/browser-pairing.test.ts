import assert from "node:assert/strict";
import test from "node:test";
import { browserPairingCallbackUrl, isBrowserPairingState } from "./browser-pairing.js";

const state = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const pairingCode = `pair_${"a".repeat(43)}`;

test("browser pairing state requires 32 base64url bytes", () => {
  assert.equal(isBrowserPairingState(state), true);
  assert.equal(isBrowserPairingState(`${state}x`), false);
  assert.equal(isBrowserPairingState("not valid"), false);
});

test("browser pairing callback uses the fixed app target", () => {
  const callback = new URL(browserPairingCallbackUrl(pairingCode, state));
  assert.equal(callback.protocol, "omgskills:");
  assert.equal(callback.host, "pair");
  assert.equal(callback.searchParams.get("code"), pairingCode);
  assert.equal(callback.searchParams.get("state"), state);
});

test("browser pairing callback rejects malformed input", () => {
  assert.throws(() => browserPairingCallbackUrl("bad", state));
  assert.throws(() => browserPairingCallbackUrl(pairingCode, "bad"));
});
