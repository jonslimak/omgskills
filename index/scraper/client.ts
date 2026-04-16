import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { config } from "dotenv";

config();

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("GITHUB_TOKEN missing — create index/.env with GITHUB_TOKEN=<fine-grained PAT>");
}

const HardenedOctokit = Octokit.plugin(throttling, retry);

export const octokit = new HardenedOctokit({
  auth: token,
  retry: {
    doNotRetry: ["429"], // let throttling plugin handle rate-limits
  },
  throttle: {
    onRateLimit: (retryAfter, options, _octokit, retryCount) => {
      console.warn(
        `[rate-limit] ${options.method} ${options.url} — retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
      );
      return retryCount < 2;
    },
    onSecondaryRateLimit: (retryAfter, options) => {
      console.warn(
        `[secondary-limit] ${options.method} ${options.url} — retrying after ${retryAfter}s`,
      );
      return true;
    },
  },
});
