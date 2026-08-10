import { octokit } from "../client.js";
import type { ShadowCadence } from "./types.js";

export const COMBINED_GITHUB_CORE_QUOTA_MINIMUM = 2000;

export type GitHubCoreQuota = {
  remaining: number;
  reset: number | undefined;
};

type GitHubRateLimitClient = {
  rest: {
    rateLimit: {
      get: () => Promise<{
        data: {
          resources?: {
            core?: {
              remaining?: number;
              reset?: number;
            };
          };
          rate?: {
            remaining?: number;
            reset?: number;
          };
        };
      }>;
    };
  };
};

export function shouldCheckGitHubQuota(cadence: ShadowCadence): boolean {
  return cadence === "combined";
}

function formatResetTime(resetSeconds: number | undefined): string {
  if (!resetSeconds) return "unknown";
  return new Date(resetSeconds * 1000).toISOString();
}

export async function getGitHubCoreQuota(
  client: GitHubRateLimitClient = octokit,
): Promise<GitHubCoreQuota> {
  const { data } = await client.rest.rateLimit.get();
  const core = data.resources?.core ?? data.rate;
  return {
    remaining: core?.remaining ?? 0,
    reset: core?.reset,
  };
}

export async function assertGitHubCoreQuotaAvailable(
  minimumRemaining: number,
  operation: string,
  client: GitHubRateLimitClient = octokit,
): Promise<GitHubCoreQuota> {
  const quota = await getGitHubCoreQuota(client);
  if (quota.remaining < minimumRemaining) {
    throw new Error(
      `GitHub core quota too low for ${operation}: remaining=${quota.remaining}, required=${minimumRemaining}, reset=${formatResetTime(quota.reset)}`,
    );
  }
  console.log(`  GitHub core quota preflight: ${quota.remaining} remaining`);
  return quota;
}

export async function assertGitHubQuotaAvailable(
  cadence: ShadowCadence,
  client: GitHubRateLimitClient = octokit,
  minimumRemaining = COMBINED_GITHUB_CORE_QUOTA_MINIMUM,
): Promise<void> {
  if (!shouldCheckGitHubQuota(cadence)) return;

  await assertGitHubCoreQuotaAvailable(minimumRemaining, "combined crawl", client);
}
