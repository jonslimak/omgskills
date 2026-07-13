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

test("manual production deploy never tags a Mac release without explicit opt-in", () => {
  const optIn = 'if [ "${1:-}" = "--tag-release" ]';
  const guard = 'if [ "$TAG_RELEASE" = true ]';
  const tag = 'git tag "v$VERSION"';

  assert.match(script, /TAG_RELEASE=false/);
  assert.notEqual(script.indexOf(optIn), -1);
  assert.notEqual(script.indexOf(guard), -1);
  assert.ok(script.indexOf(tag) > script.indexOf(guard));
  assert.match(script, /Mac release tagging skipped/);
  assert.match(script, /Usage: \.\/scripts\/deploy-site-prod\.sh \[--tag-release\]/);
});

test("manual production deploy checks generated config and every deploy input", () => {
  assert.match(script, /\.netlify\/netlify\.toml/);
  assert.match(script, /PRODUCTION_ORIGIN="https:\/\/omgskills\.com"/);
  assert.doesNotMatch(script, /\$\{PRODUCTION_ORIGIN/);
  for (const input of [".github/workflows", "netlify", "package-lock.json", "portal", "scripts", "site"]) {
    assert.match(script, new RegExp(`\\n  ${input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n`));
  }
});
