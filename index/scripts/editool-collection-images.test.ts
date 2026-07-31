import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CollectionsPolicySource } from "../scraper/policy/types.js";
import {
  COLLECTION_IMAGE_MAX_BYTES,
  collectionImageFilePath,
  collectionImageHash,
  collectionImagePublicUrl,
  verifyCollectionImageReferences,
  writeCollectionImage,
} from "./collection-images.js";

function webp(payload = "image-data"): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP"),
    Buffer.from(payload),
  ]);
}

function source(imageUrl: string | null): CollectionsPolicySource {
  return {
    collections: [{
      id: "starter-pack",
      type: "topic",
      title: "Starter Pack",
      subtitle: "Useful skills",
      imageUrl,
      featuredSkillIds: [],
      skillIds: [],
    }],
  };
}

test("writes a versioned WebP atomically", (t) => {
  const root = mkdtempSync(join(tmpdir(), "collection-image-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = webp();
  const result = writeCollectionImage({ siteRoot: root, id: "starter-pack", data });

  assert.equal(result.imageUrl, collectionImagePublicUrl("starter-pack", data));
  assert.equal(result.hash, collectionImageHash(data));
  assert.deepEqual(readFileSync(collectionImageFilePath(root, "starter-pack")), data);
  assert.deepEqual(readdirSync(join(root, "images", "collections")), ["starter-pack.webp"]);
});

test("rejects unsafe IDs, oversized bodies, and non-WebP bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "collection-image-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(() => writeCollectionImage({ siteRoot: root, id: "../escape", data: webp() }), /invalid collection id/);
  assert.throws(() => writeCollectionImage({ siteRoot: root, id: "starter-pack", data: Buffer.from("PNG") }), /WebP/);
  assert.throws(
    () => writeCollectionImage({
      siteRoot: root,
      id: "starter-pack",
      data: Buffer.concat([webp(), Buffer.alloc(COLLECTION_IMAGE_MAX_BYTES)]),
    }),
    /exceeds/,
  );
});

test("verifies referenced files and content hashes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "collection-image-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = webp();
  const imageUrl = collectionImagePublicUrl("starter-pack", data);

  assert.match(verifyCollectionImageReferences(source(imageUrl), root).errors[0] ?? "", /missing/);
  writeCollectionImage({ siteRoot: root, id: "starter-pack", data });
  assert.deepEqual(verifyCollectionImageReferences(source(imageUrl), root), { checked: 1, errors: [] });
  assert.match(
    verifyCollectionImageReferences(source(imageUrl.replace(/v=[a-f0-9]{12}/, "v=000000000000")), root).errors[0] ?? "",
    /hash does not match/,
  );
});
