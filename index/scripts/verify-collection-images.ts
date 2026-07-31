import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import { verifyCollectionImageReferences } from "./collection-images.js";

const indexRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(indexRoot, "..");
const siteRoot = resolve(process.env.SITE_DIR ?? resolve(repoRoot, "site"));
const source = typedPolicySources(loadPolicySources()).collections;
const result = verifyCollectionImageReferences(source, siteRoot);

if (result.errors.length) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

console.log(`verified ${result.checked} collection images`);
