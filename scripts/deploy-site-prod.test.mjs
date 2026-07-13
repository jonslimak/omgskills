import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-site-prod.sh", import.meta.url), "utf8");

test("manual production deploy uses the guarded combined artifact in order", () => {
  const commands = [
    "node ./scripts/prepare-netlify-site-deploy.mjs",
    "npm ci",
    "npm run build:netlify",
    "npx netlify-cli deploy --prod --dir=dist/netlify-site --no-build",
    "node ./scripts/verify-production-deploy.mjs",
    "node ./scripts/verify-web-library-pages.mjs --live",
    "git tag \"v$VERSION\"",
  ];

  let previousIndex = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert.notEqual(index, -1, `missing command: ${command}`);
    assert.ok(index > previousIndex, `command is out of order: ${command}`);
    previousIndex = index;
  }

  assert.doesNotMatch(script, /--dir=site(?:\s|$)/);
});

test("manual production deploy checks generated config and every deploy input", () => {
  assert.match(script, /\.netlify\/netlify\.toml/);
  assert.match(script, /PRODUCTION_ORIGIN="https:\/\/omgskills\.com"/);
  assert.doesNotMatch(script, /\$\{PRODUCTION_ORIGIN/);
  for (const input of [".github/workflows", "netlify", "package-lock.json", "portal", "scripts", "site"]) {
    assert.match(script, new RegExp(`\\n  ${input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n`));
  }
});
