import { readFileSync, writeFileSync } from "node:fs";
import { prepareSearchCatalog } from "./search-catalog.mjs";

const [dataDir, manifestPath, previousPath] = process.argv.slice(2);
if (!dataDir || !manifestPath || !previousPath) throw new Error("Usage: search-catalog-cli.mjs <data-dir> <next-manifest> <previous-manifest>");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const old = readFileSync(previousPath, "utf8").trim();
prepareSearchCatalog(dataDir, manifest, old ? JSON.parse(old) : {});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
