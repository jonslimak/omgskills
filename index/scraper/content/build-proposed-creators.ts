import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProposedCreatorsReport,
  formatProposedCreatorsMarkdown,
  type AuthorLeaderboardRowLike,
  type CreatorRegistryLike,
  type GoldBasketSkillLike,
  type ShadowReportLike,
} from "./proposed-creators-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main() {
  const report = buildProposedCreatorsReport({
    generatedAt: new Date().toISOString(),
    registry: readJson<CreatorRegistryLike>(join(root, "seeds", "creators.json"), { creators: [] }),
    goldBasket: readJson<GoldBasketSkillLike[]>(join(root, "gold-basket.json"), []),
    authorLeaderboards: readJson<AuthorLeaderboardRowLike[]>(join(root, "author-leaderboards.json"), []),
    shadowReport: readJson<ShadowReportLike | undefined>(join(root, "shadow", "shadow-report.json"), undefined),
    limit: Number(process.env.PROPOSED_CREATORS_LIMIT ?? 50),
  });

  writeFileSync(join(root, "proposed-creators.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(root, "proposed-creators.md"), formatProposedCreatorsMarkdown(report));
  console.log(`proposed-creators: wrote ${report.candidateCount} candidates`);
}

main();
