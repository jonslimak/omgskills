import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tweetsPath = join(here, "..", "top-x-skill-tweets.json");

function strictMode() {
  return process.env.X_STRICT === "1";
}

function hasXCredentials() {
  return process.env.ENABLE_X_SOCIAL === "1" && Boolean(process.env.X_AUTH_TOKEN && process.env.X_CT0);
}

function run(label: string, args: string[]) {
  console.log(`x: ${label}`);
  const result = spawnSync("npx", ["tsx", ...args], {
    cwd: join(here, ".."),
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function main() {
  if (hasXCredentials()) {
    const collectStatus = run("collecting tweets", ["scraper/collect-x-skill-tweets.ts"]);
    if (collectStatus !== 0) {
      if (strictMode()) process.exit(collectStatus);
      console.warn("x: collect failed; preserving current skills.json");
      return;
    }
  } else {
    const message = "x: collect skipped, set ENABLE_X_SOCIAL=1 plus X_AUTH_TOKEN and X_CT0 to refresh tweets";
    if (strictMode()) {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
    return;
  }

  if (!existsSync(tweetsPath)) {
    const message = "x: merge skipped, no top-x-skill-tweets.json artifact";
    if (strictMode()) {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
    return;
  }

  const mergeStatus = run("merging tweet metadata", ["scraper/merge-x-skill-tweets.ts"]);
  if (mergeStatus !== 0) process.exit(mergeStatus);
}

main();
