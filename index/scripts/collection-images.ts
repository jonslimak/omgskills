import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { CollectionsPolicySource } from "../scraper/policy/types.js";

export const COLLECTION_IMAGE_MAX_BYTES = 1_000_000;
export const COLLECTION_IMAGE_ORIGIN = "https://omgskills.com";
const COLLECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_HASH_PATTERN = /^[a-f0-9]{12}$/;

export type CollectionImageVerification = {
  checked: number;
  errors: string[];
};

export function assertCollectionId(id: string): void {
  if (!COLLECTION_ID_PATTERN.test(id)) {
    throw new Error(`invalid collection id: ${id}`);
  }
}

export function collectionImageRelativePath(id: string): string {
  assertCollectionId(id);
  return `images/collections/${id}.webp`;
}

export function collectionImageFilePath(siteRoot: string, id: string): string {
  return join(siteRoot, collectionImageRelativePath(id));
}

export function isWebP(data: Buffer): boolean {
  return data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP";
}

export function collectionImageHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function collectionImagePublicUrl(
  id: string,
  data: Buffer,
  origin = COLLECTION_IMAGE_ORIGIN,
): string {
  const normalizedOrigin = new URL(origin).origin;
  return `${normalizedOrigin}/${collectionImageRelativePath(id)}?v=${collectionImageHash(data).slice(0, 12)}`;
}

export function parseCollectionImageUrl(
  value: string,
  expectedId: string,
  origin = COLLECTION_IMAGE_ORIGIN,
): { hash: string } | null {
  try {
    assertCollectionId(expectedId);
    const url = new URL(value);
    const expectedOrigin = new URL(origin).origin;
    if (url.origin !== expectedOrigin) return null;
    if (url.pathname !== `/${collectionImageRelativePath(expectedId)}`) return null;
    if (url.hash || [...url.searchParams.keys()].some((key) => key !== "v")) return null;
    const hash = url.searchParams.get("v") ?? "";
    if (!IMAGE_HASH_PATTERN.test(hash) || url.searchParams.getAll("v").length !== 1) return null;
    return { hash };
  } catch {
    return null;
  }
}

export function validateCollectionImageData(data: Buffer): void {
  if (data.length === 0) throw new Error("collection image is empty");
  if (data.length > COLLECTION_IMAGE_MAX_BYTES) {
    throw new Error(`collection image exceeds ${COLLECTION_IMAGE_MAX_BYTES} bytes`);
  }
  if (!isWebP(data)) throw new Error("collection image must be a WebP file");
}

export function writeCollectionImage(options: {
  siteRoot: string;
  id: string;
  data: Buffer;
  origin?: string;
}): { filePath: string; imageUrl: string; hash: string } {
  assertCollectionId(options.id);
  validateCollectionImageData(options.data);

  const filePath = collectionImageFilePath(options.siteRoot, options.id);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(temporaryPath, options.data, { flag: "wx", mode: 0o644 });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }

  const hash = collectionImageHash(options.data);
  return {
    filePath,
    hash,
    imageUrl: collectionImagePublicUrl(options.id, options.data, options.origin),
  };
}

export function verifyCollectionImageReferences(
  source: CollectionsPolicySource,
  siteRoot: string,
  origin = COLLECTION_IMAGE_ORIGIN,
): CollectionImageVerification {
  const errors: string[] = [];
  let checked = 0;

  for (const collection of source.collections) {
    if (!collection.imageUrl) continue;
    checked += 1;
    const parsed = parseCollectionImageUrl(collection.imageUrl, collection.id, origin);
    if (!parsed) {
      errors.push(`${collection.id}: invalid collection image URL`);
      continue;
    }
    const filePath = collectionImageFilePath(siteRoot, collection.id);
    if (!existsSync(filePath)) {
      errors.push(`${collection.id}: missing ${collectionImageRelativePath(collection.id)}`);
      continue;
    }
    const data = readFileSync(filePath);
    try {
      validateCollectionImageData(data);
    } catch (error) {
      errors.push(`${collection.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!collectionImageHash(data).startsWith(parsed.hash)) {
      errors.push(`${collection.id}: image hash does not match imageUrl`);
    }
  }

  return { checked, errors };
}

export async function verifyLiveCollectionImageReferences(
  source: CollectionsPolicySource,
  fetchImpl: typeof fetch = fetch,
  origin = COLLECTION_IMAGE_ORIGIN,
): Promise<CollectionImageVerification> {
  const errors: string[] = [];
  let checked = 0;

  for (const collection of source.collections) {
    if (!collection.imageUrl) continue;
    checked += 1;
    const parsed = parseCollectionImageUrl(collection.imageUrl, collection.id, origin);
    if (!parsed) {
      errors.push(`${collection.id}: invalid collection image URL`);
      continue;
    }
    try {
      const response = await fetchImpl(collection.imageUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        errors.push(`${collection.id}: live image returned HTTP ${response.status}`);
        continue;
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/webp") {
        errors.push(`${collection.id}: live image content-type must be image/webp`);
        continue;
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > COLLECTION_IMAGE_MAX_BYTES) {
        errors.push(`${collection.id}: live image exceeds ${COLLECTION_IMAGE_MAX_BYTES} bytes`);
        continue;
      }
      const data = Buffer.from(await response.arrayBuffer());
      try {
        validateCollectionImageData(data);
      } catch (error) {
        errors.push(`${collection.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!collectionImageHash(data).startsWith(parsed.hash)) {
        errors.push(`${collection.id}: live image hash does not match imageUrl`);
      }
    } catch (error) {
      errors.push(`${collection.id}: live image request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { checked, errors };
}
