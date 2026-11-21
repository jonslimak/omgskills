import type { Config } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { GitHubBrokerClient } from "./_shared/github-broker.js";
import { loadOwnerPrivateReleasePackage } from "./_shared/private-releases.js";
import { runScanQueue, scanDriverConfigFromEnv } from "./_shared/scan-driver.js";

// Scans private skills in the background. Nothing anyone does waits on it.
export const config: Config = { schedule: "*/2 * * * *" };

export default async () => {
  const scanConfig = scanDriverConfigFromEnv();
  if (!scanConfig) return new Response(null, { status: 204 });
  const pool = getPgPool();
  const broker = new GitHubBrokerClient();
  try {
    const result = await runScanQueue(pool, {
      config: scanConfig,
      loadPrivatePackage: async (input) => (await loadOwnerPrivateReleasePackage(pool, broker, input)).package
    });
    console.info("scan queue", result);
    return new Response(null, { status: 204 });
  } catch (error) {
    // Only a code or message, never file contents.
    console.error("scan queue run failed; trying again next run", { error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 500 });
  }
};
