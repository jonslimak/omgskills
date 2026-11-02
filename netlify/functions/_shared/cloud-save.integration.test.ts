import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";
import {
  CLOUD_SAVE_LIMITS,
  CloudSaveError,
  listCloudVersions,
  loadCloudVersionPackage,
  markDeletedLocally,
  readCloudSave,
  saveCloudVersion,
  storeCloudBlob,
  updateCloudSaveSettings
} from "./cloud-save.js";
import { CloudStoreError, type CloudObjectStore } from "./cloud-store.js";
import { gitObjectSha, validateSkillPackage, type SkillManifestEntry } from "./skill-package.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for cloud save integration tests");
}

const migrationsDirectory = fileURLToPath(new URL("../../database/migrations", import.meta.url));

async function withMigratedSchema(run: (pool: Pool) => Promise<void>) {
  const schema = `cloud_save_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString });
  const client = await admin.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    const entries = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      await client.query(await readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8"));
    }
  } finally {
    client.release();
  }
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

class MemoryStore implements CloudObjectStore {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, Buffer.from(body));
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new CloudStoreError("not_found", "Saved file is missing");
    return object;
  }
}

async function createUser(pool: Pool) {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3)", [id, `cloud-${id}`, `${id}@example.com`]);
  const device = await pool.query<{ id: string }>(
    `
      INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at, granted_scopes)
      VALUES ($1, $2, 'Mac', now() + interval '1 day', ARRAY['sync:write', 'self:revoke', 'content:read', 'content:write'])
      RETURNING id
    `,
    [id, `hash-${id}`]
  );
  return { userId: id, deviceId: device.rows[0].id };
}

type File = { path: string; text: string; mode?: string };

function manifest(files: File[]): SkillManifestEntry[] {
  return files.map((file) => {
    const data = Buffer.from(file.text);
    return { path: file.path, mode: file.mode ?? "100644", blobSha: gitObjectSha("blob", data), byteSize: data.byteLength };
  });
}

async function uploadAll(pool: Pool, store: CloudObjectStore, userId: string, files: File[]) {
  for (const file of files) {
    const data = Buffer.from(file.text);
    await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", data), data });
  }
}

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof CloudSaveError && error.code === code);
}

const v1: File[] = [
  { path: "SKILL.md", text: "---\nname: notes\ndescription: Take notes.\n---\n# Notes\n" },
  { path: "scripts/run.sh", text: "echo hi\n", mode: "100755" }
];
const v2: File[] = [{ ...v1[0], text: `${v1[0].text}More.\n` }, v1[1]];

test("a skill saves in two steps, keeps every version, and loads back byte for byte", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);

    await rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "Notes", files: manifest(v1) }), "disabled");
    await updateCloudSaveSettings(pool, userId, { enabled: true });

    const first = await saveCloudVersion(pool, { userId, deviceId, skillKey: "Notes", files: manifest(v1) });
    assert.equal(first.status, "missing_files");
    assert.equal(first.status === "missing_files" && first.missing.length, 2);

    await uploadAll(pool, store, userId, v1);
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "Notes", files: manifest(v1) });
    assert.equal(saved.status, "saved");
    assert.ok(saved.status === "saved" && saved.created);
    assert.equal(saved.status === "saved" && saved.skill.key, "notes");

    const again = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.ok(again.status === "saved" && !again.created);

    await uploadAll(pool, store, userId, v2);
    const edited = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v2) });
    assert.ok(edited.status === "saved" && edited.created);

    const versions = await listCloudVersions(pool, { userId, skillKey: "notes" });
    assert.equal(versions.length, 2);

    const state = await readCloudSave(pool, userId);
    assert.equal(state.skills.length, 1);
    assert.equal(state.skills[0].versionCount, 2);
    assert.equal(state.skills[0].currentVersion.id, edited.status === "saved" && edited.skill.currentVersion.id);
    assert.equal(state.skills[0].currentVersion.deviceId, deviceId);
    // Unchanged files are stored once: three distinct blobs for two versions.
    assert.equal(store.objects.size, 3);
    assert.equal(state.usage.limitBytes, CLOUD_SAVE_LIMITS.maximumUserBytes);

    // Saving the earlier content again makes it current without a new version.
    const restored = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.ok(restored.status === "saved" && !restored.created);
    assert.equal((await readCloudSave(pool, userId)).skills[0].currentVersion.id,
      saved.status === "saved" && saved.skill.currentVersion.id);

    const loaded = await loadCloudVersionPackage(pool, store, {
      userId,
      releaseId: edited.status === "saved" ? edited.skill.currentVersion.id : ""
    });
    validateSkillPackage(loaded.package, loaded.package.coordinates);
    assert.deepEqual(
      loaded.package.entries.map((entry) => [entry.path, entry.mode, entry.data.toString()]),
      v2.map((file) => [file.path, file.mode ?? "100644", file.text]).sort()
    );
  });
});

test("only the owner can load a saved version", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const owner = await createUser(pool);
    const other = await createUser(pool);
    await updateCloudSaveSettings(pool, owner.userId, { enabled: true });
    await uploadAll(pool, store, owner.userId, v1);
    const saved = await saveCloudVersion(pool, { ...owner, skillKey: "notes", files: manifest(v1) });
    assert.equal(saved.status, "saved");
    const releaseId = saved.status === "saved" ? saved.skill.currentVersion.id : "";
    await rejects(loadCloudVersionPackage(pool, store, { userId: other.userId, releaseId }), "not_found");
    await rejects(listCloudVersions(pool, { userId: other.userId, skillKey: "notes" }), "not_found");

    // Another user's stored files don't count as uploaded for this user.
    await updateCloudSaveSettings(pool, other.userId, { enabled: true });
    const attempt = await saveCloudVersion(pool, { ...other, skillKey: "notes", files: manifest(v1) });
    assert.equal(attempt.status, "missing_files");
  });
});

test("uploads are checked against their hash, size limit and the user's choices", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    const data = Buffer.from("hello\n");
    await rejects(storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", data), data }), "disabled");
    await updateCloudSaveSettings(pool, userId, { enabled: true, excludedSkillKeys: ["private-notes"] });

    await rejects(storeCloudBlob(pool, store, { userId, blobSha: "0".repeat(40), data }), "blob_mismatch");
    const large = Buffer.alloc(CLOUD_SAVE_LIMITS.maximumFileBytes + 1);
    await rejects(storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", large), data: large }), "file_too_large");
    assert.equal(store.objects.size, 0);

    const stored = await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", data), data });
    assert.equal(stored.stored, true);
    assert.equal((await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", data), data })).stored, false);

    await rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "Private-Notes", files: manifest(v1) }), "excluded");
    await rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "../x", files: manifest(v1) }), "invalid_skill_key");
    await rejects(saveCloudVersion(pool, {
      userId,
      deviceId,
      skillKey: "notes",
      files: manifest([{ path: "README.md", text: "no skill file" }])
    }), "invalid_package");
    await rejects(saveCloudVersion(pool, {
      userId,
      deviceId,
      skillKey: "notes",
      files: manifest(v1),
      expectedTreeSha: "1".repeat(40)
    }), "invalid_package");

    // A file listed with the wrong size is refused even when its hash is stored.
    await uploadAll(pool, store, userId, v1);
    const wrongSize = manifest(v1).map((file, index) => index === 0 ? { ...file, byteSize: file.byteSize + 1 } : file);
    await rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: wrongSize }), "invalid_package");
  });
});

test("the storage limit counts each stored file once", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await pool.query(
      "INSERT INTO cloud_blobs (user_id, blob_sha, byte_size) VALUES ($1, $2, $3)",
      [userId, "a".repeat(40), CLOUD_SAVE_LIMITS.maximumUserBytes - 3]
    );
    const small = Buffer.from("ab");
    assert.equal((await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", small), data: small })).stored, true);
    const more = Buffer.from("cd");
    await rejects(storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", more), data: more }), "quota_exceeded");
    assert.equal((await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", small), data: small })).stored, false);
  });
});

test("a skill deleted on the Mac keeps its cloud copy until it is saved again", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });

    const deleted = await markDeletedLocally(pool, { userId, skillKey: "notes", deleted: true });
    assert.ok(deleted.deletedLocallyAt);
    assert.equal((await readCloudSave(pool, userId)).skills[0].deletedLocallyAt, deleted.deletedLocallyAt);
    await rejects(markDeletedLocally(pool, { userId, skillKey: "missing", deleted: true }), "not_found");

    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.equal((await readCloudSave(pool, userId)).skills[0].deletedLocallyAt, null);

    // Turning cloud save off keeps what is saved.
    await updateCloudSaveSettings(pool, userId, { enabled: false });
    const state = await readCloudSave(pool, userId);
    assert.equal(state.settings.enabled, false);
    assert.equal(state.skills.length, 1);
  });
});

test("saved versions and their files can't be changed or deleted", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    const releaseId = saved.status === "saved" ? saved.skill.currentVersion.id : "";
    await assert.rejects(pool.query("DELETE FROM cloud_release_files WHERE release_id = $1", [releaseId]), /append-only/);
    await assert.rejects(pool.query("UPDATE cloud_releases SET file_count = 9 WHERE release_id = $1", [releaseId]), /append-only/);
  });
});

test("the endpoints save, list and download a skill for a paired Mac", async () => {
  const { portalCloudSave } = await import("../portal-cloud-save.mjs");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    const scopes: string[] = [];
    const dependencies = {
      available: () => true,
      pool: () => pool,
      store: () => store,
      requireUser: async () => ({ userId, deviceId: null }),
      requireDevice: async (_req: Request, scope: string) => {
        scopes.push(scope);
        return { userId, deviceId };
      }
    };
    const device = { authorization: `Bearer device_${"a".repeat(43)}` };
    const call = (method: string, route: string, body?: BodyInit, headers: Record<string, string> = device) =>
      portalCloudSave(new Request(`https://omgskills.com/api/portal/cloud-save${route}`, { method, body, headers }), {} as never, dependencies as never);
    const json = (value: unknown) => JSON.stringify(value);

    assert.equal((await call("PUT", "/settings", json({ enabled: true }), {})).status, 200);
    const files = manifest(v1);
    const missing = await call("POST", `/skills/${encodeURIComponent("My Notes")}/versions`, json({ files }));
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).missing.length, 2);
    for (const file of v1) {
      const data = Buffer.from(file.text);
      const response = await call("PUT", `/blobs/${gitObjectSha("blob", data)}`, data);
      assert.equal(response.status, 201);
    }
    const saved = await call("POST", `/skills/${encodeURIComponent("My Notes")}/versions`, json({ files }));
    assert.equal(saved.status, 201);
    const { skill } = await saved.json();
    assert.equal(skill.key, "my notes");

    const state = await (await call("GET", "", undefined, {})).json();
    assert.equal(state.skills[0].key, "my notes");
    const versions = await (await call("GET", `/skills/${encodeURIComponent("my notes")}/versions`)).json();
    assert.equal(versions.versions.length, 1);

    const download = await call("GET", `/versions/${skill.currentVersion.id}/package`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    const lines = (await download.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].releaseId, skill.currentVersion.id);
    assert.deepEqual(lines.filter((line) => line.type === "file").map((line) => line.path).sort(), ["SKILL.md", "scripts/run.sh"]);

    const deleted = await call("PUT", `/skills/${encodeURIComponent("my notes")}/deleted-locally`, json({ deleted: true }));
    assert.equal(deleted.status, 200);

    // Uploads and downloads always need the device's own scopes, never a web session.
    assert.deepEqual(scopes, [
      "content:write", "content:write", "content:write", "content:write",
      "sync:write", "content:read", "content:write"
    ]);
  });
});
