const OPAQUE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type BrowserPairingRequest = {
  state: string;
  codeChallenge: string;
  scopes: DeviceScope[];
};

export const BASE_DEVICE_SCOPES = ["sync:write", "self:revoke"] as const;
export const ALL_DEVICE_SCOPES = [...BASE_DEVICE_SCOPES, "content:read"] as const;
export type DeviceScope = typeof ALL_DEVICE_SCOPES[number];

function parseScopes(params: URLSearchParams): DeviceScope[] | null {
  const values = params.getAll("scope");
  if (values.length === 0) return [...BASE_DEVICE_SCOPES];
  const scopes = [...new Set(values)];
  if (
    scopes.length !== values.length
    || scopes.some((scope) => !ALL_DEVICE_SCOPES.includes(scope as DeviceScope))
    || BASE_DEVICE_SCOPES.some((scope) => !scopes.includes(scope))
  ) {
    return null;
  }
  return ALL_DEVICE_SCOPES.filter((scope) => scopes.includes(scope));
}

export function parseBrowserPairingRequest(hash: string): BrowserPairingRequest | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const states = params.getAll("state");
  const challenges = params.getAll("code_challenge");
  const scopes = parseScopes(params);
  if (
    states.length !== 1
    || challenges.length !== 1
    || !OPAQUE_VALUE_PATTERN.test(states[0])
    || !OPAQUE_VALUE_PATTERN.test(challenges[0])
    || scopes === null
  ) {
    return null;
  }
  return { state: states[0], codeChallenge: challenges[0], scopes };
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
