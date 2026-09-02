import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { config } from "dotenv";
import {
  parseOptionalPositiveDurationMs,
  shouldRetryGitHubRateLimit,
} from "./runtime-guard.js";

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
const maxRateLimitWaitSeconds = parseOptionalPositiveDurationMs(
  "V2_SCRAPER_MAX_RATE_LIMIT_WAIT_SECONDS",
  process.env.V2_SCRAPER_MAX_RATE_LIMIT_WAIT_SECONDS,
  1,
) ?? 120;

const HardenedOctokit = Octokit.plugin(throttling, retry);

export const octokit = new HardenedOctokit({
  auth: token,
  ...(requestTimeoutMs === null ? {} : { request: { timeout: requestTimeoutMs } }),
  retry: {
    doNotRetry: [400, 401, 403, 404, 409, 422, 429],
  },
  throttle: {
    onRateLimit: (retryAfter, options, _octokit, retryCount) => {
      const retry = shouldRetryGitHubRateLimit(
        retryAfter,
        retryCount,
        maxRateLimitWaitSeconds,
        disableThrottleRetry,
      );
      console.warn(
        `[rate-limit] ${options.method} ${options.url} — ` +
        `${retry ? `retrying after ${retryAfter}s` : `deferring instead of waiting ${retryAfter}s`} ` +
        `(attempt ${retryCount + 1})`,
      );
      return retry;
    },
    onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
      const retry = shouldRetryGitHubRateLimit(
        retryAfter,
        retryCount,
        maxRateLimitWaitSeconds,
        disableThrottleRetry,
      );
      console.warn(
        `[secondary-limit] ${options.method} ${options.url} — ` +
        `${retry ? `retrying after ${retryAfter}s` : `deferring instead of waiting ${retryAfter}s`}`,
      );
      return retry;
    },
  },
});
