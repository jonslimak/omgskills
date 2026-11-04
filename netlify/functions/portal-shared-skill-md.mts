import type { Config, Context } from "@netlify/functions";
import { portalPrivateReleases } from "./portal-private-releases.mjs";

// Reading a shared skill's instructions on the web; its own rate limit so panel opens never slow Mac downloads.
export default async (req: Request, context: Context) => portalPrivateReleases(req, context);

export const config: Config = {
  path: "/api/portal/private-releases/:releaseId/skill-md",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 60,
    windowSize: 60
  }
};
