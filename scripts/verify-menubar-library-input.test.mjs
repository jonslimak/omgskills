import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyMenubarLibraryInput } from "./verify-menubar-library-input.mjs";

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "menubar-library-input-"));
  const indexDir = join(repoRoot, "index");
  const dataDir = join(repoRoot, "site/data/v2");
  mkdirSync(indexDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const skills = [{ id: "owner/repo:skill", author_handle: "owner" }];
  const skillsData = Buffer.from(`${JSON.stringify(skills, null, 2)}\n`);
  const assetName = "skills-test.json";
  writeFileSync(join(indexDir, "skills.json"), skillsData);
  writeFileSync(join(dataDir, assetName), skillsData);
  writeFileSync(join(dataDir, "manifest.json"), `${JSON.stringify({
    version: 2,
    skills: {
      path: assetName,
      bytes: skillsData.length,
      sha256: createHash("sha256").update(skillsData).digest("hex"),
    },
  }, null, 2)}\n`);

  return {
    repoRoot,
    manifestPath: join(dataDir, "manifest.json"),
    assetPath: join(dataDir, assetName),
  };
}

function withFixture(run) {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
}

test("accepts a clean checkout with a byte-identical hashed v2 asset", () => {
  withFixture(({ repoRoot, manifestPath }) => {
    const result = verifyMenubarLibraryInput({ repoRoot, manifestPath });
    assert.equal(result.shadowValidated, false);
  });
});

test("rejects a v2 asset whose contents no longer match its manifest hash", () => {
  withFixture(({ repoRoot, manifestPath, assetPath }) => {
    writeFileSync(assetPath, "tampered\n");
    assert.throws(
      () => verifyMenubarLibraryInput({ repoRoot, manifestPath }),
      /byte count mismatch|hash mismatch/
    );
  });
});

test("rejects promoted skills that differ from the validated v2 asset", () => {
  withFixture(({ repoRoot, manifestPath }) => {
    writeFileSync(join(repoRoot, "index/skills.json"), "[]\n");
    assert.throws(
      () => verifyMenubarLibraryInput({ repoRoot, manifestPath }),
      /not byte-identical/
    );
  });
});

test("rejects incomplete or stale shadow validation when shadow files exist", () => {
  withFixture(({ repoRoot, manifestPath }) => {
    const shadowDir = join(repoRoot, "index/shadow");
    mkdirSync(shadowDir, { recursive: true });
    writeFileSync(join(shadowDir, "shadow-report.json"), '{"cutoverValidationPassed":true}\n');
    assert.throws(
      () => verifyMenubarLibraryInput({ repoRoot, manifestPath }),
      /shadow validation is incomplete/
    );

    writeFileSync(
      join(shadowDir, "skills.cutover.shadow.json"),
      '[{"id":"owner/repo:stale","author_handle":"owner"}]\n'
    );
    assert.throws(
      () => verifyMenubarLibraryInput({ repoRoot, manifestPath }),
      /shadow cutover does not match/
    );
  });
});

test("the Mac build invokes the reproducible v2 verifier", () => {
  const buildScript = readFileSync(new URL("../menubar/build.sh", import.meta.url), "utf8");
  assert.match(buildScript, /verify-menubar-library-input\.mjs/);
});
