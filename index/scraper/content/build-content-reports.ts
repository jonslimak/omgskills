import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface EnrichedBasketSkill {
  gh_enriched_at?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const basketPath = join(root, "gold-basket.json");
const staleDays = Number(process.env.BASKET_ENRICHMENT_STALE_DAYS ?? 8);

function run(command: string, args: string[]) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function validateBasketEnrichment() {
  if (!existsSync(basketPath)) {
    throw new Error("gold-basket.json missing after build");
  }

  const basket = JSON.parse(readFileSync(basketPath, "utf8")) as EnrichedBasketSkill[];
  if (basket.length === 0) {
    throw new Error("gold-basket.json is empty");
  }

  const enrichedAtValues = basket
    .map((skill) => skill.gh_enriched_at)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (enrichedAtValues.length !== basket.length) {
    throw new Error("gold-basket.json is not fully enriched");
  }

  const latest = Math.max(...enrichedAtValues.map((value) => new Date(value).getTime()));
  const ageDays = (Date.now() - latest) / 86_400_000;
  if (ageDays > staleDays) {
    throw new Error(`gold-basket enrichment is stale (${ageDays.toFixed(1)} days old)`);
  }
}

function main() {
  run("npm", ["run", "content:fetch-essentials"]);
  run("npm", ["run", "content:build-basket"]);
  run("npm", ["run", "content:enrich-basket"]);
  validateBasketEnrichment();
  run("npm", ["run", "content:author-leaderboards"]);
  run("npm", ["run", "content:stats"]);
  run("npm", ["run", "content:stats-html"]);
  run("npm", ["run", "content:leaderboards"]);
  run("npm", ["run", "content:growth-html"]);
  run("npm", ["run", "content:review-html"]);
  run("npm", ["run", "content:dashboard"]);
}

main();
