import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildMomentumSignals } from "./momentum.js";

function discovered(
  rows: Array<{ repo: string; sources: string[] }>,
): Map<string, { repo: string; sources: Set<string> }> {
  return new Map(rows.map((row) => [row.repo, { repo: row.repo, sources: new Set(row.sources) }]));
}

test("repo with skillssh source gets skillssh momentum", () => {
  const tmp = mkdtempSync(join(tmpdir(), "momentum-test-"));
  const result = buildMomentumSignals(
    discovered([{ repo: "owner/repo", sources: ["skillssh"] }]),
    join(tmp, "missing.json"),
  );

  assert.deepEqual([...result.momentumByRepo.get("owner/repo") ?? []], ["skillssh"]);
  assert.equal(result.warning, "validated X artifact missing");
  rmSync(tmp, { recursive: true, force: true });
});

test("repo from validated X artifact gets validatedX momentum", () => {
  const tmp = mkdtempSync(join(tmpdir(), "momentum-test-"));
  const artifactPath = join(tmp, "top-x-skill-tweets.json");
  writeFileSync(
    artifactPath,
    JSON.stringify([{ valid_skill_repos: [{ id: "owner/repo" }] }], null, 2),
    "utf8",
  );

  const result = buildMomentumSignals(discovered([]), artifactPath);

  assert.deepEqual([...result.momentumByRepo.get("owner/repo") ?? []], ["validatedX"]);
  assert.equal(result.warning, null);
  rmSync(tmp, { recursive: true, force: true });
});

test("repo present in both sources gets one entry with both labels", () => {
  const tmp = mkdtempSync(join(tmpdir(), "momentum-test-"));
  const artifactPath = join(tmp, "top-x-skill-tweets.json");
  writeFileSync(
    artifactPath,
    JSON.stringify([{ valid_skill_repos: [{ id: "OWNER/REPO" }] }], null, 2),
    "utf8",
  );

  const result = buildMomentumSignals(
    discovered([{ repo: "owner/repo", sources: ["skillssh"] }]),
    artifactPath,
  );

  assert.deepEqual([...result.momentumByRepo.get("owner/repo") ?? []].sort(), ["skillssh", "validatedX"]);
  rmSync(tmp, { recursive: true, force: true });
});

test("rows without usable valid_skill_repos ids are ignored", () => {
  const tmp = mkdtempSync(join(tmpdir(), "momentum-test-"));
  const artifactPath = join(tmp, "top-x-skill-tweets.json");
  writeFileSync(
    artifactPath,
    JSON.stringify([
      { valid_skill_repos: [{ id: "" }, {}] },
      {},
    ], null, 2),
    "utf8",
  );

  const result = buildMomentumSignals(discovered([]), artifactPath);

  assert.equal(result.momentumByRepo.size, 0);
  assert.equal(result.warning, null);
  rmSync(tmp, { recursive: true, force: true });
});
