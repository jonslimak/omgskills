import { readFileSync, writeFileSync } from "node:fs";
import { prepareSearchCatalog } from "./search-catalog.mjs";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--bootstrap-ranking") {
  if (args.length !== 2 || !args[1]) throw new Error("Usage: search-catalog-cli.mjs --bootstrap-ranking <data-dir>");
  const dataDir = args[1], previous = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const manifest = structuredClone(previous);
  prepareSearchCatalog(dataDir, manifest, previous, true, true);
  publishCatalogManifest({ dataDir, manifest, previousManifest: previous, prefixes: [] });
  console.log("Ranked search bundle prepared; existing source and manifest fields preserved.");
} else {
  const [dataDir, manifestPath, previousPath] = args;
  if (args.length !== 3 || !dataDir || !manifestPath || !previousPath) throw new Error("Usage: search-catalog-cli.mjs <data-dir> <next-manifest> <previous-manifest>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const old = readFileSync(previousPath, "utf8").trim();
  prepareSearchCatalog(dataDir, manifest, old ? JSON.parse(old) : {});
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
