import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

function createPrefixedToken(prefix: "pair_" | "device_") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function createSyncToken() {
  return randomBytes(32).toString("base64url");
}

export function createPairingCode() {
  return createPrefixedToken("pair_");
}

export function createDeviceCredential() {
  return createPrefixedToken("device_");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isPairingCode(value: string) {
  return value.startsWith("pair_") && OPAQUE_SECRET_PATTERN.test(value.slice("pair_".length));
}

export function isDeviceCredential(value: string) {
  return value.startsWith("device_") && OPAQUE_SECRET_PATTERN.test(value.slice("device_".length));
}

export function isCodeChallenge(value: string) {
  return CODE_CHALLENGE_PATTERN.test(value);
}

export function isCodeVerifier(value: string) {
  return CODE_VERIFIER_PATTERN.test(value);
}

export function codeChallengeForVerifier(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyCodeChallenge(verifier: string, expectedChallenge: string) {
  if (!isCodeVerifier(verifier) || !isCodeChallenge(expectedChallenge)) {
    return false;
  }
  const actual = Buffer.from(codeChallengeForVerifier(verifier));
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
