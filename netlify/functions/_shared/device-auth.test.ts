import assert from "node:assert/strict";
import test from "node:test";
import {
  codeChallengeForVerifier,
  createDeviceCredential,
  createPairingCode,
  isCodeChallenge,
  isCodeVerifier,
  isDeviceCredential,
  isPairingCode,
  verifyCodeChallenge
} from "./crypto.js";
import { requireJsonObject } from "./validation.js";

const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

test("creates strongly typed pairing and device credentials", () => {
  const pairingCode = createPairingCode();
  const deviceCredential = createDeviceCredential();

  assert.equal(isPairingCode(pairingCode), true);
  assert.equal(isDeviceCredential(deviceCredential), true);
  assert.equal(pairingCode.length, 48);
  assert.equal(deviceCredential.length, 50);
  assert.equal(isPairingCode(deviceCredential), false);
  assert.equal(isDeviceCredential(pairingCode), false);
});

test("validates S256 challenges and verifiers", () => {
  const challenge = codeChallengeForVerifier(verifier);

  assert.equal(isCodeVerifier(verifier), true);
  assert.equal(isCodeChallenge(challenge), true);
  assert.equal(verifyCodeChallenge(verifier, challenge), true);
  assert.equal(verifyCodeChallenge(`${verifier}x`, challenge), false);
});

test("rejects malformed credential and PKCE values", () => {
  assert.equal(isPairingCode("pair_short"), false);
  assert.equal(isDeviceCredential("device_short"), false);
  assert.equal(isCodeChallenge("not-a-sha256-challenge"), false);
  assert.equal(isCodeVerifier("short"), false);
  assert.equal(verifyCodeChallenge("short", "also-short"), false);
});

test("rejects malformed and non-object JSON payloads", async () => {
  await assert.rejects(
    requireJsonObject(new Request("https://example.com", { method: "POST", body: "{" })),
    (error) => error instanceof Response && error.status === 400
  );
  await assert.rejects(
    requireJsonObject(new Request("https://example.com", { method: "POST", body: "[]" })),
    (error) => error instanceof Response && error.status === 400
  );
});
