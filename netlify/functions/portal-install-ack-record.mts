import type { Context } from "@netlify/functions";
import { portalInstallAck } from "./portal-install-ack.mjs";

/** The Mac app's POST /api/portal/install-ack, in its own function so the pop-over's polls can't use up its limit. */
export default (req: Request, context: Context) => portalInstallAck(req, context);

export const config = {
  path: "/api/portal/install-ack",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 60,
    windowSize: 60
  }
};
