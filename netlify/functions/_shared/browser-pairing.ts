import { isPairingCode } from "./crypto.js";

const BROWSER_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type CallbackTarget = "omgskills://pair" | "omgskills-f1://pair";

function loopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:"
      || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || !url.port
      || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function browserPairingCallbackTarget(
  req: Request,
  env: Record<string, string | undefined> = process.env,
  deployContext?: string
): CallbackTarget {
  const flag = env.OMGSKILLS_CONNECTED_INVENTORY_TEST;
  if (flag === undefined || flag === "0") return "omgskills://pair";

  const configuredOrigin = loopbackOrigin(env.PORTAL_TEST_API_ORIGIN ?? "");
  const requestOrigin = new URL(req.url).origin;
  const browserOrigin = req.headers.get("origin");
  if (
    flag !== "1"
    || env.CONTEXT !== "dev"
    || (deployContext !== undefined && deployContext !== "dev")
    || env.NODE_ENV === "production"
    || env.PORTAL_TEST_ENVIRONMENT_VERIFIED !== "1"
    || !configuredOrigin
    || requestOrigin !== configuredOrigin
    || (browserOrigin !== null && !loopbackOrigin(browserOrigin))
  ) {
    throw new Response("Invalid connected inventory test configuration", { status: 503 });
  }
  return "omgskills-f1://pair";
}

export function isBrowserPairingState(value: unknown): value is string {
  return typeof value === "string" && BROWSER_STATE_PATTERN.test(value);
}

export function browserPairingCallbackUrl(
  pairingCode: string,
  state: string,
  target: CallbackTarget = "omgskills://pair"
) {
  if (
    !isPairingCode(pairingCode) || !isBrowserPairingState(state)
    || (target !== "omgskills://pair" && target !== "omgskills-f1://pair")
  ) {
    throw new Error("Invalid browser pairing callback");
  }

  const callback = new URL(target);
  callback.searchParams.set("code", pairingCode);
  callback.searchParams.set("state", state);
  return callback.toString();
}
