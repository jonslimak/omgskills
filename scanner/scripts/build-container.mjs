// Bundles the container server into one file the image runs, with our rules' version set to a
// hash of the rules and the code that reports them, so any change gives a new version and a re-scan.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const hash = createHash("sha256");
for (const file of [
  "../../netlify/functions/_shared/skill-scan.ts",
  "../container/src/scanners/omg-rules.ts",
  "../src/protocol.ts"
]) {
  hash.update(await readFile(here(file)));
}
const version = `1-${hash.digest("hex").slice(0, 12)}`;

await build({
  entryPoints: [here("../container/src/server.ts")],
  outfile: here("../container/dist/server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  define: { OMG_RULES_VERSION: JSON.stringify(version) },
  logLevel: "warning"
});
console.log(`omg-rules ${version}`);
