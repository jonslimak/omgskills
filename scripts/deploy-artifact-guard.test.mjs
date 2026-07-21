import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractUpdateAssetPaths,
  requiredReleaseAssetPaths,
  verifyReleaseDeployArtifacts,
  verifyWebLibraryDeployArtifacts,
} from "./deploy-artifact-guard.mjs";
import { finalizeReleaseAssets } from "./finalize-release-assets.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omgskills-deploy-guard-"));
  const files = [
    "downloads/omgskills-mac.dmg",
    "downloads/omgskills-mac.dmg.sha256",
    "updates/omgskills-1.0.0.zip",
    "updates/omgskills1-09.delta",
  ];
  await writeFile(
    join(root, "appcast.xml"),
    '<enclosure url="https://omgskills.com/updates/omgskills-1.0.0.zip"/>\n' +
      '<sparkle:delta url="https://omgskills.com/updates/omgskills1-09.delta"/>\n',
  );
  for (const relativePath of files) {
    await mkdir(join(root, relativePath, ".."), { recursive: true });
    await writeFile(join(root, relativePath), "fixture");
  }
  return { root, files };
}

test("extracts unique update assets deterministically", () => {
  const xml = [
    '<x url="https://omgskills.com/updates/b.zip"/>',
    '<x url="https://omgskills.com/updates/a.zip"/>',
    '<x url="https://omgskills.com/updates/b.zip"/>',
    '<x url="https://example.com/other.zip"/>',
  ].join("\n");
  assert.deepEqual(extractUpdateAssetPaths(xml), ["updates/a.zip", "updates/b.zip"]);
});

test("release artifact verification passes with DMG, checksum, and appcast updates", async () => {
  const { root, files } = await fixture();
  try {
    assert.deepEqual(await requiredReleaseAssetPaths(root), files);
    await verifyReleaseDeployArtifacts(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release artifact verification reports every missing asset", async () => {
  const { root } = await fixture();
  try {
    await rm(join(root, "downloads", "omgskills-mac.dmg"));
    await rm(join(root, "updates", "omgskills-1.0.0.zip"));
    await assert.rejects(
      verifyReleaseDeployArtifacts(root, "test artifact"),
      /test artifact is unsafe: missing release assets: downloads\/omgskills-mac\.dmg, updates\/omgskills-1\.0\.0\.zip/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release artifact verification rejects appcasts without update assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "omgskills-deploy-guard-"));
  try {
    await writeFile(join(root, "appcast.xml"), "<rss></rss>");
    await assert.rejects(requiredReleaseAssetPaths(root), /appcast\.xml has no \/updates\/ assets/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release finalization restores referenced Sparkle assets and removes its archive", async () => {
  const { root } = await fixture();
  const archivedDir = join(root, "updates", "old_updates");
  const delta = "omgskills1-09.delta";
  try {
    await mkdir(archivedDir, { recursive: true });
    await rename(join(root, "updates", delta), join(archivedDir, delta));
    await writeFile(join(archivedDir, "obsolete.delta"), "fixture");

    assert.deepEqual(await finalizeReleaseAssets(root), [`updates/${delta}`]);
    await verifyReleaseDeployArtifacts(root);
    await assert.rejects(access(archivedDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("web library verification requires the generated catalog skill URL asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "omgskills-web-library-guard-"));
  const files = [
    "library/anthropics/index.html",
    "skills/anthropics/skills/frontend-design/index.html",
    "collections/starter-pack/index.html",
    "skills/index.html",
    "sitemap.xml",
    "robots.txt",
    "llms.txt",
    "catalog-skill-urls.json",
  ];
  try {
    for (const relativePath of files) {
      await mkdir(join(root, relativePath, ".."), { recursive: true });
      await writeFile(join(root, relativePath), "fixture");
    }
    await verifyWebLibraryDeployArtifacts(root);
    await rm(join(root, "catalog-skill-urls.json"));
    await assert.rejects(
      verifyWebLibraryDeployArtifacts(root, "test artifact"),
      /test artifact is unsafe: missing generated web library deploy artifacts: catalog-skill-urls\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
