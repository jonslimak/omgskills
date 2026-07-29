import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { config } from "dotenv";
import { parseOptionalPositiveDurationMs } from "./runtime-guard.js";

config();

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("GITHUB_TOKEN missing — create index/.env with GITHUB_TOKEN=<fine-grained PAT>");
}

const disableThrottleRetry = process.env.OMGSKILLS_DISABLE_OCTOKIT_SECONDARY_RETRY === "1";
const requestTimeoutMs = parseOptionalPositiveDurationMs(
  "V2_SCRAPER_REQUEST_TIMEOUT_MS",
  process.env.V2_SCRAPER_REQUEST_TIMEOUT_MS,
  1,
);

const HardenedOctokit = Octokit.plugin(throttling, retry);

export const octokit = new HardenedOctokit({
  auth: token,
  ...(requestTimeoutMs === null ? {} : { request: { timeout: requestTimeoutMs } }),
  retry: {
    doNotRetry: [400, 401, 403, 404, 409, 422, 429],
  },
  throttle: {
    onRateLimit: (retryAfter, options, _octokit, retryCount) => {
      console.warn(
        `[rate-limit] ${options.method} ${options.url} — retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
      );
      if (disableThrottleRetry) return false;
      return retryCount < 2;
    },
    onSecondaryRateLimit: (retryAfter, options) => {
      console.warn(
        `[secondary-limit] ${options.method} ${options.url} — retrying after ${retryAfter}s`,
      );
      return !disableThrottleRetry;
    },
  },
});
