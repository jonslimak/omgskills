import assert from "node:assert/strict";
import test from "node:test";
import { browserPairingCancelUrl, parseBrowserPairingRequest } from "../src/browser-pairing.js";

const state = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const challenge = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

test("parses one valid state and challenge from a fragment", () => {
  assert.deepEqual(
    parseBrowserPairingRequest(`#state=${state}&code_challenge=${challenge}`),
    { state, codeChallenge: challenge }
  );
});

test("rejects malformed or duplicate browser pairing values", () => {
  assert.equal(parseBrowserPairingRequest("#state=bad&code_challenge=bad"), null);
  assert.equal(
    parseBrowserPairingRequest(`#state=${state}&state=${state}&code_challenge=${challenge}`),
    null
  );
});

test("cancel callback uses the fixed app target", () => {
  const callback = new URL(browserPairingCancelUrl(state));
  assert.equal(callback.protocol, "omgskills:");
  assert.equal(callback.host, "pair");
  assert.equal(callback.searchParams.get("error"), "access_denied");
  assert.equal(callback.searchParams.get("state"), state);
});
