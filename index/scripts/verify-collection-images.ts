import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import {
  verifyCollectionImageReferences,
  verifyLiveCollectionImageReferences,
} from "./collection-images.js";

const indexRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(indexRoot, "..");
const siteRoot = resolve(process.env.SITE_DIR ?? resolve(repoRoot, "site"));
const source = typedPolicySources(loadPolicySources()).collections;
const args = process.argv.slice(2);
const live = args.includes("--live");
const unknownArgs = args.filter((arg) => arg !== "--live");
if (unknownArgs.length) {
  console.error(`unsupported arguments: ${unknownArgs.join(", ")}`);
  process.exit(2);
}
const result = live
  ? await verifyLiveCollectionImageReferences(source)
  : verifyCollectionImageReferences(source, siteRoot);

if (result.errors.length) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

console.log(`verified ${result.checked} ${live ? "live " : ""}collection images`);
