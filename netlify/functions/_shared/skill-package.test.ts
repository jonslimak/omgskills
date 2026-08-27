import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROKER_SKILL_PACKAGE_LIMITS,
  gitObjectSha,
  skillPackageNdjson,
  SkillPackageValidationError,
  type SkillPackage,
  validateSkillPackage
} from "./skill-package.js";

const commitSha = "a".repeat(40);

function treeSha(entries: Array<{ path: string; mode: string; blobSha: string }>): string {
  const nodes = entries.map((entry) => ({ ...entry, components: entry.path.split("/") }));
  function directorySha(prefix: string[]): string {
    const objects = new Map<string, { mode: string; sha: string; directory: boolean }>();
    for (const entry of nodes) {
      if (entry.components.slice(0, prefix.length).join("/") !== prefix.join("/")) continue;
      const name = entry.components[prefix.length];
      if (!name) continue;
      if (entry.components.length === prefix.length + 1) {
        objects.set(name, { mode: entry.mode, sha: entry.blobSha, directory: false });
      } else if (!objects.has(name)) {
        objects.set(name, { mode: "40000", sha: directorySha([...prefix, name]), directory: true });
      }
    }
    const sorted = [...objects.entries()].sort(([leftName, left], [rightName, right]) => Buffer.compare(
      Buffer.from(`${leftName}${left.directory ? "/" : ""}`),
      Buffer.from(`${rightName}${right.directory ? "/" : ""}`)
    ));
    const content = Buffer.concat(sorted.flatMap(([name, object]) => [
      Buffer.from(`${object.mode} ${name}\0`),
      Buffer.from(object.sha, "hex")
    ]));
    return createHash("sha1")
      .update(Buffer.from(`tree ${content.byteLength}\0`))
      .update(content)
      .digest("hex");
  }
  return directorySha([]);
}

function packageFixture(extraEntries: SkillPackage["entries"] = []): SkillPackage {
  const skillData = Buffer.from("# Example\n");
  const entries = [{
    path: "SKILL.md",
    mode: "100644",
    data: skillData,
    blobSha: gitObjectSha("blob", skillData)
  }, ...extraEntries];
  return {
    coordinates: {
      commitSha,
      treeSha: treeSha(entries),
      skillMdSha: entries[0].blobSha
    },
    entries
  };
}

function expectFailure(code: SkillPackageValidationError["code"], operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof SkillPackageValidationError && error.code === code
  ));
}

test("validates a complete multi-file package and Git coordinates", () => {
  const script = Buffer.from("#!/bin/sh\necho ok\n");
  const skillPackage = packageFixture([{
    path: "scripts/run.sh",
    mode: "100755",
    data: script,
    blobSha: gitObjectSha("blob", script)
  }]);
  const result = validateSkillPackage(skillPackage, skillPackage.coordinates);
  assert.equal(result.fileCount, 2);
  assert.equal(result.totalBytes, skillPackage.entries.reduce((sum, entry) => sum + entry.data.byteLength, 0));
});

test("validates the shared server-client package fixture", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../../../menubar/Tests/omgskillsTests/Fixtures/skill-package-validation-v1.json", import.meta.url),
    "utf8"
  ));
  const skillPackage: SkillPackage = {
    coordinates: fixture.coordinates,
    entries: fixture.entries.map((entry: any) => ({
      path: entry.path,
      mode: entry.mode,
      blobSha: entry.blobSha,
      data: Buffer.from(entry.dataBase64, "base64")
    }))
  };
  assert.equal(fixture.version, 1);
  assert.equal(validateSkillPackage(skillPackage, skillPackage.coordinates).fileCount, 1);
});

test("rejects unsafe entry types, portable collisions, and invalid bytes", () => {
  const data = Buffer.from("content");
  for (const [mode, code] of [["120000", "symbolic_link"], ["160000", "submodule"]] as const) {
    const skillPackage = packageFixture([{
      path: "unsafe",
      mode,
      data,
      blobSha: gitObjectSha("blob", data)
    }]);
    expectFailure(code, () => validateSkillPackage(skillPackage, skillPackage.coordinates));
  }

  const collision = packageFixture([{
    path: "readme.md",
    mode: "100644",
    data,
    blobSha: gitObjectSha("blob", data)
  }, {
    path: "README.md",
    mode: "100644",
    data,
    blobSha: gitObjectSha("blob", data)
  }]);
  expectFailure("case_collision", () => validateSkillPackage(collision, collision.coordinates));

  const badBlob = packageFixture();
  badBlob.entries[0].data = Buffer.from("changed");
  expectFailure("blob_sha_mismatch", () => validateSkillPackage(badBlob, badBlob.coordinates));
});

test("broker validation rejects packages above its transport limit", () => {
  const first = Buffer.alloc(7 * 1024 * 1024, 1);
  const second = Buffer.alloc(6 * 1024 * 1024, 2);
  const skillPackage = packageFixture([{
    path: "first.bin",
    mode: "100644",
    data: first,
    blobSha: gitObjectSha("blob", first)
  }, {
    path: "second.bin",
    mode: "100644",
    data: second,
    blobSha: gitObjectSha("blob", second)
  }]);
  expectFailure("package_too_large", () => validateSkillPackage(
    skillPackage,
    skillPackage.coordinates,
    BROKER_SKILL_PACKAGE_LIMITS
  ));
});

test("creates a versioned no-partial NDJSON package after validation", async () => {
  const skillPackage = packageFixture();
  const stream = skillPackageNdjson({
    sourceId: "source-id",
    releaseId: "release-id",
    package: skillPackage
  });
  const body = await new Response(stream.body).text();
  assert.equal(Buffer.byteLength(body), stream.contentLength);
  const lines = body.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], {
    type: "omgskills.skill_package",
    version: 1,
    sourceId: "source-id",
    releaseId: "release-id",
    coordinates: skillPackage.coordinates,
    fileCount: 1
  });
  assert.equal(Buffer.from(lines[1].data, "base64").toString(), "# Example\n");
  assert.deepEqual(lines[2], { type: "end" });

  const invalid = packageFixture();
  invalid.entries[0].data = Buffer.from("changed");
  expectFailure("blob_sha_mismatch", () => skillPackageNdjson({
    sourceId: "source-id",
    releaseId: "release-id",
    package: invalid
  }));
});
