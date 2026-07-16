import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectManifestAssetPaths,
  prepareEditoolPreviewWorkspace,
  resolvePreviewFilePath,
} from "./editool-preview.js";

test("collects unique asset paths from a manifest", () => {
  assert.deepEqual(
    collectManifestAssetPaths({
      skills: { path: "skills.json", bytes: 10 },
      optional: [{ path: "collections.json" }, { path: "skills.json" }],
    }).sort(),
    ["collections.json", "skills.json"],
  );
});

test("prepares an isolated workspace with copied manifests and linked assets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "editool-preview-test-"));
  const sourceSiteDir = join(root, "site");
  const previewDir = join(root, "preview");
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(sourceSiteDir, { recursive: true });
  await writeFile(join(sourceSiteDir, "index.html"), "home");
  await writeFile(join(sourceSiteDir, "robots.txt"), "robots");
  await writeFile(join(sourceSiteDir, "llms.txt"), "llms");

  for (const track of ["", "v2", "crawl4"]) {
    const dataDir = join(sourceSiteDir, "data", track);
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "skills.json"), `${track || "root"} skills`);
    await writeFile(
      join(dataDir, "manifest.json"),
      JSON.stringify({ skills: { path: "skills.json" } }),
    );
  }
  await writeFile(join(sourceSiteDir, "data", "crawl4", "stale.json"), "not referenced");

  await prepareEditoolPreviewWorkspace(sourceSiteDir, previewDir);

  assert.equal(await readFile(join(previewDir, "index.html"), "utf8"), "home");
  assert.equal(
    await readFile(join(previewDir, "data", "crawl4", "skills.json"), "utf8"),
    "crawl4 skills",
  );
  assert.equal((await lstat(join(previewDir, "data", "crawl4", "manifest.json"))).isSymbolicLink(), false);
  assert.equal((await lstat(join(previewDir, "data", "crawl4", "skills.json"))).isSymbolicLink(), true);
  await assert.rejects(lstat(join(previewDir, "data", "crawl4", "stale.json")));
});

test("preview paths stay inside the preview root", () => {
  const root = "/tmp/editool-preview";
  assert.equal(resolvePreviewFilePath(root, "/skills/"), "/tmp/editool-preview/skills/index.html");
  assert.equal(resolvePreviewFilePath(root, "/../../secret"), null);
  assert.equal(resolvePreviewFilePath(root, "/%2e%2e/%2e%2e/secret"), null);
});
