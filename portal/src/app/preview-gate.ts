export function isLocalPreview(input: {
  development: boolean;
  enabled: string | undefined;
  hostname: string;
  pathname: string;
}) {
  return (
    input.development &&
    input.enabled === "1" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(input.hostname) &&
    /^\/app\/preview(?:\/|$)/.test(input.pathname)
  );
}
