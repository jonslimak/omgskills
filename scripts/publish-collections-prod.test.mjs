import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("./publish-collections-prod.sh", import.meta.url);
const script = await readFile(scriptUrl, "utf8");

test("collection dispatcher is executable and requires reviewed main", async () => {
  const info = await stat(scriptUrl);
  assert.notEqual(info.mode & 0o111, 0);
  assert.match(script, /git status --porcelain/);
  assert.match(script, /git fetch origin main/);
  assert.match(script, /expected_sha="\$\(git rev-parse HEAD\)"/);
  assert.match(script, /origin_sha="\$\(git rev-parse origin\/main\)"/);
  assert.doesNotMatch(script, /git merge-base --is-ancestor/);
});

test("collection dispatcher validates, dispatches the exact SHA, and waits", () => {
  const validate = script.indexOf("npm --prefix index run collections:verify-images");
  const dispatch = script.indexOf("gh workflow run publish-collections.yml");
  const watch = script.indexOf("gh run watch");
  assert.ok(validate !== -1 && validate < dispatch && dispatch < watch);
  assert.match(script, /-f "expected_sha=\$expected_sha"/);
  assert.match(script, /--impact-override/);
  assert.match(script, /--exit-status/);
  assert.doesNotMatch(script, /git commit|git push|deploy:production|netlify-cli deploy/);
});
