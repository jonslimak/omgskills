export function isLocalIntegration(input: {
  development: boolean;
  enabled: string | undefined;
  hostname: string;
  pathname: string;
}) {
  return (
    input.development &&
    input.enabled === "1" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(input.hostname) &&
    /^\/app\/integration(?:\/|$)/.test(input.pathname)
  );
}

export function integrationConfigurationError(input: {
  ready: boolean;
  publishableKey: string | undefined;
  webEnabled: string | undefined;
}) {
  if (!input.ready)
    return "An isolated test backend must be verified before sign-in is enabled.";
  if (!input.publishableKey?.startsWith("pk_test_"))
    return "A Clerk development publishable key is required.";
  if (input.webEnabled !== "1")
    return "The local Skill Groups web gate is disabled.";
  return null;
}
