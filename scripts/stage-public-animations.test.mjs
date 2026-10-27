import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publicAnimations, stagePublicAnimations } from "./stage-public-animations.mjs";

test("stages only the reviewed animation pages, unchanged", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-animations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "output");
  await mkdir(path.join(root, "animation"));
  for (const filename of [...publicAnimations, "draft.html"]) {
    await writeFile(path.join(root, "animation", filename), `<title>${filename}</title>`);
  }
  await stagePublicAnimations(root, output);
  assert.deepEqual((await readdir(path.join(output, "animation"))).sort(), [...publicAnimations].sort());
  for (const filename of publicAnimations) {
    assert.deepEqual(await readFile(path.join(output, "animation", filename)),
      await readFile(path.join(root, "animation", filename)));
  }
  await assert.rejects(stagePublicAnimations(root, output), { code: "ERR_FS_CP_EEXIST" });
});

test("missing animation stops the build instead of silently publishing without it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-animations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(stagePublicAnimations(root, path.join(root, "output")), { code: "ENOENT" });
});

test("combined build stages animations after copying the site", async () => {
  const source = await readFile(new URL("./build-netlify-site.mjs", import.meta.url), "utf8");
  const copy = source.indexOf("await cp(siteDir, outputDir");
  const stage = source.indexOf("await stagePublicAnimations(repoRoot, outputDir)");
  assert.ok(copy >= 0 && stage > copy);
});
