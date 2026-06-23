import { octokit } from "../client.js";
import type { ShadowCadence } from "./types.js";

export const COMBINED_GITHUB_CORE_QUOTA_MINIMUM = 2000;

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

export async function assertGitHubQuotaAvailable(
  cadence: ShadowCadence,
  client: GitHubRateLimitClient = octokit,
  minimumRemaining = COMBINED_GITHUB_CORE_QUOTA_MINIMUM,
): Promise<void> {
  if (!shouldCheckGitHubQuota(cadence)) return;

  const { data } = await client.rest.rateLimit.get();
  const core = data.resources?.core ?? data.rate;
  const remaining = core?.remaining ?? 0;
  const reset = core?.reset;

  if (remaining < minimumRemaining) {
    throw new Error(
      `GitHub core quota too low for combined crawl: remaining=${remaining}, required=${minimumRemaining}, reset=${formatResetTime(reset)}`,
    );
  }

  console.log(`  GitHub core quota preflight: ${remaining} remaining`);
}
