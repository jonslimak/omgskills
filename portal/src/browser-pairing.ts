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

export function isBrowserPairingApproval(body: Record<string, unknown>) {
  const keys = ["state", "codeChallenge", "codeChallengeMethod", "scopes"];
  const scopes = body.scopes;
  return Object.keys(body).length === keys.length && Object.keys(body).every(key => keys.includes(key))
    && typeof body.state === "string" && OPAQUE_VALUE_PATTERN.test(body.state)
    && typeof body.codeChallenge === "string" && OPAQUE_VALUE_PATTERN.test(body.codeChallenge)
    && body.codeChallengeMethod === "S256" && Array.isArray(scopes)
    && new Set(scopes).size === scopes.length
    && scopes.every(scope => ALL_DEVICE_SCOPES.includes(scope))
    && BASE_DEVICE_SCOPES.every(scope => scopes.includes(scope));
}

export const connectedInventoryDisclosure = "Share skill names, descriptions, agent, folder name, SKILL.md fingerprint and safe source information (repository and relative path), including skills installed outside OMGSkills. Fingerprints may identify skills. Full local paths and full skill files are not uploaded.";

export function connectedPairingCallback(callback: string, state: string) {
  const url = new URL(callback);
  if (url.protocol !== "omgskills-f1:" || url.host !== "pair" || url.pathname || url.hash
    || url.username || url.password || url.searchParams.get("state") !== state
    || !OPAQUE_VALUE_PATTERN.test(state) || !/^pair_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code") ?? "")
    || [...url.searchParams.keys()].length !== 2) {
    throw new Error("Invalid connected test pairing callback.");
  }
  return url.toString();
}

export function browserPairingCancelUrl(state: string, connectedInventory = false) {
  if (!OPAQUE_VALUE_PATTERN.test(state)) {
    throw new Error("Invalid browser pairing state");
  }
  const callback = new URL(connectedInventory ? "omgskills-f1://pair" : "omgskills://pair");
  callback.searchParams.set("error", "access_denied");
  callback.searchParams.set("state", state);
  return callback.toString();
}
