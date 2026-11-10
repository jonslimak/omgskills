import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterSourceTrending, validateSourceTrending } from "./source-trending-format.mjs";

// Prepare an optional asset; the caller still activates its entire manifest atomically.
export function prepareSourceTrending({ repoRoot, dataDir, manifest, skills }) {
  const input = join(repoRoot, "index/source-trending.json");
  if (!existsSync(input)) return;
  const readSeed = name => JSON.parse(readFileSync(join(repoRoot, "index/seeds", `${name}.json`), "utf8"));
  const blocked = readSeed("do-not-crawl");
  const policy = { blockedRepos: blocked.repos.map(rule => rule.repo), blockedOwners: blocked.owners.map(rule => rule.owner),
    catalogRepos: readSeed("catalog-repos").map(rule => rule.repo),
    suppressedIds: readSeed("suppressed-skills").skills.map(rule => rule.id) };
  const feed = filterSourceTrending(validateSourceTrending(JSON.parse(readFileSync(input, "utf8"))), policy, skills);
  const bytes = Buffer.from(`${JSON.stringify(feed, null, 2)}\n`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `source-trending-${sha256.slice(0, 12)}.json`;
  if (!existsSync(join(dataDir, path))) writeFileSync(join(dataDir, path), bytes, { flag: "wx" });
  manifest.sourceTrending = { path, sha256, bytes: bytes.length };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repoRoot, dataDir, manifestPath, skillsPath] = process.argv.slice(2);
  if (!repoRoot || !dataDir || !manifestPath || !skillsPath) throw new Error("Expected repo, data directory, candidate manifest, and skills paths");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  prepareSourceTrending({ repoRoot, dataDir, manifest, skills: JSON.parse(readFileSync(skillsPath, "utf8")) });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
