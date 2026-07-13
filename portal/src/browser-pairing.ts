const OPAQUE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type BrowserPairingRequest = {
  state: string;
  codeChallenge: string;
};

export function parseBrowserPairingRequest(hash: string): BrowserPairingRequest | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const states = params.getAll("state");
  const challenges = params.getAll("code_challenge");
  if (
    states.length !== 1
    || challenges.length !== 1
    || !OPAQUE_VALUE_PATTERN.test(states[0])
    || !OPAQUE_VALUE_PATTERN.test(challenges[0])
  ) {
    return null;
  }
  return { state: states[0], codeChallenge: challenges[0] };
}

export function browserPairingCancelUrl(state: string) {
  if (!OPAQUE_VALUE_PATTERN.test(state)) {
    throw new Error("Invalid browser pairing state");
  }
  const callback = new URL("omgskills://pair");
  callback.searchParams.set("error", "access_denied");
  callback.searchParams.set("state", state);
  return callback.toString();
}
