export type ConnectedInventoryConfiguration = {
  enabled?: string;
  development: boolean;
  integration?: string;
  ready: boolean;
  publishableKey?: string;
  webEnabled?: string;
  catalogInstall?: string;
  legacyInstall?: string;
  preview?: string;
  hostname: string;
  protocol: string;
};

// This is an operator-verified local integration, never a production feature flag.
export function connectedInventoryTestEnabled(input: ConnectedInventoryConfiguration) {
  if (input.enabled === undefined || input.enabled === "0" || input.enabled === "") return false;
  if (input.enabled !== "1" || !input.development || input.integration !== "1" || !input.ready
    || !input.publishableKey?.startsWith("pk_test_") || input.webEnabled !== "1"
    || input.catalogInstall !== "1" || input.legacyInstall === "1" || input.preview === "1"
    || !["localhost", "127.0.0.1", "[::1]"].includes(input.hostname) || input.protocol !== "http:") {
    throw new Error("Connected inventory requires a verified development loopback integration.");
  }
  return true;
}
