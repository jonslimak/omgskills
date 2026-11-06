// Reads a user's saved skill files for their own agents: the current saved version only, listed files only.
import { cloudBlobKey, type CloudObjectStore } from "./cloud-store.js";

type Database = { query: <Row = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: Row[] }> };

export type SavedFile = { path: string; bytes: number; blobSha: string; storageKey: string | null };

/** The most bytes one file read returns. */
export const LIBRARY_FILE_BYTE_LIMIT = 256 * 1024;

/** Files of the current saved version of one skill, by folder key; empty when there is no saved copy. */
export async function listSavedFiles(db: Database, userId: string, key: string): Promise<{ files: SavedFile[]; savedAt: string | null }> {
  const result = await db.query<SavedFile & { savedAt: string }>(
    `
      SELECT file.path, file.byte_size::int AS bytes, file.blob_sha AS "blobSha", blob.storage_key AS "storageKey",
        to_char(release.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "savedAt"
      FROM cloud_saved_skills saved
      JOIN skill_releases release ON release.id = saved.current_release_id
      JOIN cloud_release_files file ON file.release_id = saved.current_release_id
      LEFT JOIN cloud_blobs blob ON blob.user_id = saved.user_id AND blob.blob_sha = file.blob_sha
      WHERE saved.user_id = $1 AND saved.skill_key = $2
      ORDER BY file.path COLLATE "C"
    `,
    [userId, key],
  );
  return { files: result.rows.map(({ savedAt: _, ...file }) => file), savedAt: result.rows[0]?.savedAt ?? null };
}

export type FileRead = { path: string; bytes: number; encoding: "utf8" | "base64"; content: string; truncated: boolean };

/** One listed file. Text comes back as text; anything else as base64. Large files are cut at the limit. */
export async function readSavedFile(store: CloudObjectStore, userId: string, file: SavedFile): Promise<FileRead> {
  const data = await store.get(file.storageKey ?? cloudBlobKey(userId, file.blobSha));
  const bytes = new Uint8Array(data);
  const truncated = bytes.length > LIBRARY_FILE_BYTE_LIMIT;
  let text: string | null = null;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* not text */ }
  if (text !== null && !text.includes("\u0000")) {
    // Cut text by bytes without splitting a character.
    const content = truncated ? new TextDecoder().decode(bytes.subarray(0, LIBRARY_FILE_BYTE_LIMIT)).replace(/\uFFFD$/, "") : text;
    return { path: file.path, bytes: bytes.length, encoding: "utf8", content, truncated };
  }
  const slice = truncated ? bytes.subarray(0, LIBRARY_FILE_BYTE_LIMIT) : bytes;
  return { path: file.path, bytes: bytes.length, encoding: "base64", content: Buffer.from(slice).toString("base64"), truncated };
}
