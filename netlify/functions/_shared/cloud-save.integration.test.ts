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
  loadSharedCloudPackage,
  markDeletedLocally,
  readCloudSave,
  saveCloudVersion,
  storeCloudBlob,
  updateCloudSaveSettings
} from "./cloud-save.js";
import { CloudStoreError, type CloudObjectStore } from "./cloud-store.js";
import { requirePrivateReleaseAccess } from "./private-release-access.js";
import { gitObjectSha, validateSkillPackage, type SkillManifestEntry } from "./skill-package.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for cloud save integration tests");
}

const migrationsDirectory = fileURLToPath(new URL("../../database/migrations", import.meta.url));

async function withMigratedSchema(
  run: (pool: Pool) => Promise<void>,
  maxConnections?: number,
  beforeMigration?: { name: string; run: (client: pg.PoolClient) => Promise<void> }
) {
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
      if (name === beforeMigration?.name) await beforeMigration.run(client);
      await client.query(await readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8"));
    }
  } finally {
    client.release();
  }
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public`, max: maxConnections, connectionTimeoutMillis: 2000 });
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
  readonly modified = new Map<string, Date>();
  failingPuts = new Set<string>();
  async put(key: string, body: Uint8Array) {
    if ([...this.failingPuts].some((prefix) => key === prefix || key.startsWith(`${prefix}/`))) throw new CloudStoreError("unavailable", "Storage is unavailable");
    this.objects.set(key, Buffer.from(body));
    this.modified.set(key, new Date());
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new CloudStoreError("not_found", "Saved file is missing");
    return object;
  }
  failing = new Set<string>();
  async deleteMany(keys: string[]) {
    for (const key of keys) if (!this.failing.has(key)) { this.objects.delete(key); this.modified.delete(key); }
    return keys.filter((key) => this.failing.has(key));
  }
  async listCloudObjects(token: string | null, limit: number) {
    const keys = [...this.objects.keys()].sort().filter((key) => !token || key > token);
    const page = keys.slice(0, limit);
    return { objects: page.map((key) => ({ key, modifiedAt: this.modified.get(key)! })), next: keys.length > limit ? page.at(-1)! : null };
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
    assert.match(state.skills[0].currentVersion.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Unchanged files are stored once: three distinct blobs for two versions.
    assert.equal(store.objects.size, 3);
    assert.equal(state.usage.limitBytes, CLOUD_SAVE_LIMITS.maximumUserBytes);

    // Going back to earlier content records a new version from this save, with its own time and Mac.
    const restored = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.ok(restored.status === "saved" && restored.created);
    const history = await listCloudVersions(pool, { userId, skillKey: "notes" });
    assert.equal(history.length, 3);
    assert.equal(history[0].id, restored.status === "saved" && restored.skill.currentVersion.id);
    assert.equal(history[0].treeSha, history[2].treeSha);
    assert.notEqual(history[0].id, history[2].id);
    assert.equal((await readCloudSave(pool, userId)).skills[0].currentVersion.id, history[0].id);

    const loaded = await loadCloudVersionPackage(pool, store, {
      userId,
      releaseId: edited.status === "saved" ? edited.skill.currentVersion.id : ""
    });
    assert.notEqual(loaded.package.coordinates.commitSha, loaded.package.coordinates.treeSha);
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

test("simultaneous uploads can't go past the storage limit together", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    // Room for exactly three of the ten 100-byte files sent at once.
    await pool.query(
      "INSERT INTO cloud_blobs (user_id, blob_sha, byte_size) VALUES ($1, $2, $3)",
      [userId, "a".repeat(40), CLOUD_SAVE_LIMITS.maximumUserBytes - 300]
    );
    const files = Array.from({ length: 10 }, (_, index) => Buffer.from(String(index).padEnd(100, "x")));
    const results = await Promise.allSettled(files.map((data) =>
      storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", data), data })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    assert.ok(results.every((result) => result.status === "fulfilled"
      || (result.reason instanceof CloudSaveError && result.reason.code === "quota_exceeded")));
    const used = await pool.query<{ bytes: string }>("SELECT sum(byte_size)::text AS bytes FROM cloud_blobs WHERE user_id = $1", [userId]);
    assert.equal(Number(used.rows[0].bytes), CLOUD_SAVE_LIMITS.maximumUserBytes);
    assert.equal(store.objects.size, 3);
  });
});

test("turning cloud save off or leaving a skill out stops a version save already under way", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    // The setting changes after the save's first check, just as its transaction begins.
    const changingPool = (update: Parameters<typeof updateCloudSaveSettings>[2]) => ({
      query: (text: string, values?: unknown[]) => pool.query(text, values),
      async connect() {
        const client = await pool.connect();
        const query = client.query;
        client.query = (async (text: string, values?: unknown[]) => {
          // Back to normal before anything else runs: the client returns to the shared pool.
          client.query = query;
          if (text === "BEGIN") await updateCloudSaveSettings(pool, userId, update);
          return client.query(text, values);
        }) as typeof client.query;
        return client;
      }
    }) as unknown as Pool;
    await rejects(saveCloudVersion(changingPool({ enabled: false }), { userId, deviceId, skillKey: "notes", files: manifest(v1) }), "disabled");
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await rejects(saveCloudVersion(changingPool({ excludedSkillKeys: ["notes"] }), { userId, deviceId, skillKey: "notes", files: manifest(v1) }), "excluded");
    assert.deepEqual((await readCloudSave(pool, userId)).skills, []);
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

    // Saving the same content changes nothing; the Mac that has it clears the mark itself.
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.equal((await readCloudSave(pool, userId)).skills[0].deletedLocallyAt, deleted.deletedLocallyAt);
    await markDeletedLocally(pool, { userId, skillKey: "notes", deleted: false });
    assert.equal((await readCloudSave(pool, userId)).skills[0].deletedLocallyAt, null);
    // A new version clears it too.
    await markDeletedLocally(pool, { userId, skillKey: "notes", deleted: true });
    await uploadAll(pool, store, userId, v2);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v2) });
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

const fakeToken = ["gh", "p_", "a1B2c3D4e5".repeat(4)].join("");

test("a file with a key is held back until the user confirms, and the skill waits for review", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const files: File[] = [v1[0], { path: "config.env", text: `TOKEN=${fakeToken}\n` }];
    const secret = Buffer.from(files[1].text);
    const secretSha = gitObjectSha("blob", secret);

    await storeCloudBlob(pool, store, { userId, blobSha: gitObjectSha("blob", Buffer.from(v1[0].text)), data: Buffer.from(v1[0].text) });
    await assert.rejects(
      storeCloudBlob(pool, store, { userId, deviceId, blobSha: secretSha, data: secret }),
      (error) => error instanceof CloudSaveError && error.code === "needs_review"
        && JSON.stringify(error.heldFiles) === JSON.stringify([{ rule: "github_token", kind: "GitHub token", line: 1 }])
    );
    assert.equal(store.objects.size, 1, "the held file is not stored");

    await assert.rejects(
      saveCloudVersion(pool, { userId, deviceId, skillKey: "deploy", files: manifest(files) }),
      (error) => error instanceof CloudSaveError && error.code === "needs_review"
    );
    let state = await readCloudSave(pool, userId);
    assert.deepEqual(state.needsReview.map(({ key, files, confirmed }) => ({ key, files, confirmed })), [{
      key: "deploy",
      files: [{ path: "config.env", findings: [{ rule: "github_token", kind: "GitHub token", line: 1 }] }],
      confirmed: false
    }]);
    assert.doesNotMatch(JSON.stringify(state), new RegExp(fakeToken.slice(4)));

    // Confirming on the web lets the Mac's next try through.
    const { confirmSkillReview } = await import("./cloud-save.js");
    assert.equal((await confirmSkillReview(pool, { userId, deviceId: null, skillKey: "deploy" })).confirmed, true);
    // The Mac's next pass asks to save first; the confirmed file is now just missing, so it uploads it.
    const next = await saveCloudVersion(pool, { userId, deviceId, skillKey: "deploy", files: manifest(files) });
    assert.deepEqual(next, { status: "missing_files", missing: [secretSha] });
    const stored = await storeCloudBlob(pool, store, { userId, deviceId, blobSha: secretSha, data: secret });
    assert.deepEqual(stored.labels, ["confirmed_secret"]);
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "deploy", files: manifest(files) });
    assert.ok(saved.status === "saved");
    assert.deepEqual(saved.status === "saved" && saved.skill.currentVersion.labels, ["confirmed_secret"]);
    state = await readCloudSave(pool, userId);
    assert.deepEqual(state.needsReview, []);
  });
});

test("a review belongs to its Mac's copy, and deleting the skill there clears it", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const first = await createUser(pool);
    const userId = first.userId;
    const second = await pool.query<{ id: string }>(
      `INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at, granted_scopes)
       VALUES ($1, 'hash-2', 'Mac 2', now() + interval '1 day', ARRAY['sync:write', 'self:revoke', 'content:write']) RETURNING id`,
      [userId]
    );
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId: second.rows[0].id, skillKey: "deploy", files: manifest(v1) });

    // The first Mac's copy has a key and waits for review.
    const held: File[] = [v1[0], { path: "config.env", text: `TOKEN=${fakeToken}\n` }];
    const secret = Buffer.from(held[1].text);
    await assert.rejects(storeCloudBlob(pool, store, { userId, deviceId: first.deviceId, blobSha: gitObjectSha("blob", secret), data: secret }));
    await assert.rejects(saveCloudVersion(pool, { userId, deviceId: first.deviceId, skillKey: "deploy", files: manifest(held) }));
    assert.equal((await readCloudSave(pool, userId)).needsReview.length, 1);

    // The second Mac re-saving the current content leaves the first Mac's review alone.
    await saveCloudVersion(pool, { userId, deviceId: second.rows[0].id, skillKey: "deploy", files: manifest(v1) });
    assert.equal((await readCloudSave(pool, userId)).needsReview.length, 1);

    // Deleting the skill on the first Mac clears it, even for a skill never saved.
    assert.equal((await readCloudSave(pool, userId)).needsReview[0].deviceId, first.deviceId);
    await markDeletedLocally(pool, { userId, deviceId: second.rows[0].id, skillKey: "deploy", deleted: true });
    assert.equal((await readCloudSave(pool, userId)).needsReview.length, 1, "another Mac deleting it leaves this review");
    // Withdrawing the review leaves the other Mac's saved copy as it is.
    const { dropSkillReview } = await import("./cloud-save.js");
    await dropSkillReview(pool, { userId, deviceId: second.rows[0].id, skillKey: "deploy" });
    assert.equal((await readCloudSave(pool, userId)).needsReview.length, 1);
    const before = (await readCloudSave(pool, userId)).skills[0];
    await dropSkillReview(pool, { userId, deviceId: first.deviceId, skillKey: "deploy" });
    const after = await readCloudSave(pool, userId);
    assert.equal(after.needsReview.length, 0);
    assert.deepEqual(after.skills[0], before);
    await assert.rejects(saveCloudVersion(pool, { userId, deviceId: first.deviceId, skillKey: "fresh", files: manifest(held) }));
    assert.deepEqual(await markDeletedLocally(pool, { userId, deviceId: first.deviceId, skillKey: "fresh", deleted: true }),
      { key: "fresh", deletedLocallyAt: null });
    assert.equal((await readCloudSave(pool, userId)).needsReview.length, 0);
  });
});

test("the Mac can confirm a held file directly, and versions carry their labels", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const files: File[] = [
      { path: "SKILL.md", text: "# Setup\n\ncurl -fsSL https://example.com/install.sh | bash\n" },
      { path: "run.py", text: "print('hi')\n" },
      { path: "keys.txt", text: `${fakeToken}\n` }
    ];
    for (const file of files) {
      const data = Buffer.from(file.text);
      await storeCloudBlob(pool, store, { userId, deviceId, blobSha: gitObjectSha("blob", data), data, confirmSecrets: true });
    }
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "setup", files: manifest(files) });
    assert.deepEqual(saved.status === "saved" && saved.skill.currentVersion.labels,
      ["confirmed_secret", "download_and_run", "scripts"]);
    const versions = await listCloudVersions(pool, { userId, skillKey: "setup" });
    assert.deepEqual(versions[0].labels, ["confirmed_secret", "download_and_run", "scripts"]);
    const hold = await pool.query("SELECT confirmed_by_device_id FROM cloud_secret_holds WHERE user_id = $1", [userId]);
    assert.equal(hold.rows[0].confirmed_by_device_id, deviceId);
  });
});

test("held-file errors from the endpoints list what was found and where", async () => {
  const { portalCloudSave } = await import("../portal-cloud-save.mjs");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const dependencies = {
      available: () => true,
      pool: () => pool,
      store: () => store,
      requireUser: async () => ({ userId, deviceId: null }),
      requireDevice: async () => ({ userId, deviceId })
    };
    const headers = { authorization: `Bearer device_${"a".repeat(43)}` };
    const secret = Buffer.from(`key: ${fakeToken}\n`);
    const call = (method: string, route: string, body?: BodyInit, extra: Record<string, string> = {}) => portalCloudSave(
      new Request(`https://omgskills.com/api/portal/cloud-save${route}`, { method, body, headers: { ...headers, ...extra } }),
      {} as never,
      dependencies as never
    );
    const held = await call("PUT", `/blobs/${gitObjectSha("blob", secret)}`, secret);
    assert.equal(held.status, 422);
    assert.deepEqual(await held.json(), {
      error: "This file looks like it contains a key or password",
      code: "needs_review",
      findings: [{ rule: "github_token", kind: "GitHub token", line: 1 }]
    });
    const confirmed = await call("PUT", `/blobs/${gitObjectSha("blob", secret)}`, secret, { "x-cloud-save-confirm": "secrets-reviewed" });
    assert.equal(confirmed.status, 201);
    assert.equal((await call("POST", "/skills/none/review", JSON.stringify({ confirm: true }))).status, 404);
    assert.equal((await call("POST", "/skills/none/review", JSON.stringify({}))).status, 400);
  });
});

test("a batch upload stores a skill's files in one request and reports a held file without stopping the rest", async () => {
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
    const call = (body: unknown) => portalCloudSave(new Request("https://omgskills.com/api/portal/cloud-save/blobs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer device_${"a".repeat(43)}` }
    }), {} as never, dependencies as never);
    const entry = (data: Buffer) => ({ blobSha: gitObjectSha("blob", data), data: data.toString("base64") });
    const files = [...v1.map((file) => Buffer.from(file.text)), Buffer.from(`TOKEN=${fakeToken}\n`)];

    const off = await call({ files: files.map(entry) });
    assert.equal(off.status, 403);
    assert.equal(store.objects.size, 0);

    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const first = await call({ files: files.map(entry) });
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).files.map((result: { status: string }) => result.status), ["stored", "stored", "needs_review"]);
    assert.equal(store.objects.size, 2, "the held file is not stored");

    const again = await (await call({ files: files.slice(0, 1).map(entry) })).json();
    assert.equal(again.files[0].status, "exists");
    assert.deepEqual((await readCloudSave(pool, userId)).usage.bytes, files[0].byteLength + files[1].byteLength);

    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.equal(saved.status, "saved");

    // Confirmed on the web, the held file goes through in the next batch; a repeated file is stored once.
    const { confirmSkillReview } = await import("./cloud-save.js");
    await assert.rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "deploy",
      files: manifest([v1[0], { path: "config.env", text: files[2].toString() }]) }));
    await confirmSkillReview(pool, { userId, deviceId: null, skillKey: "deploy" });
    const fresh = Buffer.from("new file\n");
    const confirmed = await (await call({ files: [files[2], fresh, fresh].map(entry) })).json();
    assert.deepEqual(confirmed.files.map((result: { status: string }) => result.status), ["stored", "stored", "stored"]);
    assert.deepEqual(confirmed.files[0].labels, ["confirmed_secret"]);
    assert.equal(store.objects.size, 4);

    // Many files fit in one request.
    const many = Array.from({ length: 200 }, (_, index) => Buffer.from(`file ${index}\n`));
    const all = await (await call({ files: many.map(entry) })).json();
    assert.equal(all.files.filter((result: { status: string }) => result.status === "stored").length, 200);
    assert.equal((await call({ files: [...many, fresh].map(entry) })).status, 400);

    assert.equal((await call({ files: [{ ...entry(files[0]), blobSha: "0".repeat(40) }] })).status, 422);
    assert.equal((await call({ files: [] })).status, 400);
    assert.equal((await call({ files: [{ blobSha: gitObjectSha("blob", files[0]) }] })).status, 400);
    const big = Buffer.alloc(CLOUD_SAVE_LIMITS.maximumFileBytes / 2 + 1, 97);
    assert.equal((await call({ files: [entry(big), entry(Buffer.concat([big, Buffer.from("b")]))] })).status, 413);
    assert.ok(scopes.every((scope) => scope === "content:write"));
  });
});

test("uploads can queue cleanup even when the pool has only one connection", async () => {
  await withMigratedSchema(async (pool) => {
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const { storeCloudBlobs } = await import("./cloud-save.js");
    const data = Buffer.from("one connection");
    const blobSha = gitObjectSha("blob", data);
    const store = new MemoryStore();
    const result = await storeCloudBlobs(pool, store, { userId, deviceId, files: [{ blobSha, data }] });
    assert.equal(result[0].status, "stored");
    assert.equal(store.objects.size, 1);
  }, 1);
});

test("a clean-up during an upload leaves its files alone, and a failed upload is cleaned up after", async () => {
  await withMigratedSchema(async (pool) => {
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const { cloudBlobKey } = await import("./cloud-store.js");
    const { drainCloudPurge, storeCloudBlobs } = await import("./cloud-save.js");
    const files = ["slow", "fail"].map((text) => {
      const data = Buffer.from(text);
      return { blobSha: gitObjectSha("blob", data), data };
    });
    const store = new MemoryStore();
    const originalPut = store.put.bind(store);
    let releaseSlow!: () => void;
    let slowStarted!: () => void;
    let failureStarted!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const started = new Promise<void>((resolve) => { slowStarted = resolve; });
    const failed = new Promise<void>((resolve) => { failureStarted = resolve; });
    store.put = async (key, data) => {
      if (key.startsWith(`${cloudBlobKey(userId, files[0].blobSha)}/`)) {
        slowStarted();
        await slowGate;
        return originalPut(key, data);
      }
      failureStarted();
      throw new CloudStoreError("unavailable", "Storage is unavailable");
    };
    let settled = false;
    const upload = storeCloudBlobs(pool, store, { userId, deviceId, files })
      .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
    try {
      await Promise.all([started, failed]);
      // Runs at once, without waiting for the upload, and leaves its reserved names alone.
      assert.equal(await drainCloudPurge(pool, store, userId), 2);
      assert.equal(settled, false, "the upload is still writing");
    } finally {
      releaseSlow();
    }
    assert.ok(await upload instanceof CloudStoreError);
    assert.equal(store.objects.size, 1, "the slow write landed after the clean-up ran");
    assert.equal(await drainCloudPurge(pool, store, userId), 0);
    assert.equal(store.objects.size, 0, "a failed upload's files are removed once its writes finish");
  });
});

test("files sent before an upload fails are cleaned up, and a retry stores them", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const { cloudBlobKey } = await import("./cloud-store.js");
    const { drainCloudPurge, storeCloudBlobs } = await import("./cloud-save.js");
    const files = Array.from({ length: 40 }, (_, index) => {
      const data = Buffer.from(`part ${index}\n`);
      return { blobSha: gitObjectSha("blob", data), data };
    });
    store.failingPuts.add(cloudBlobKey(userId, files[39].blobSha));
    await assert.rejects(storeCloudBlobs(pool, store, { userId, deviceId, files }));
    assert.ok(store.objects.size > 0, "some files reached storage before the failure");
    assert.equal((await readCloudSave(pool, userId)).usage.bytes, 0);
    assert.equal(await drainCloudPurge(pool, store, userId), 0);
    assert.equal(store.objects.size, 0, "untracked files are removed");

    store.failingPuts.clear();
    const stored = await storeCloudBlobs(pool, store, { userId, deviceId, files });
    assert.ok(stored.every((result) => result.status === "stored"));
    assert.equal(await drainCloudPurge(pool, store, userId), 0);
    assert.equal(store.objects.size, 40, "a finished upload is never cleaned up");
  });
});

test("deleting one skill removes every version and its own files, and stops saving it", async () => {
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const other: File[] = [v1[0], { path: "other.txt", text: "kept\n" }];
    await uploadAll(pool, store, userId, [...v1, ...v2, ...other]);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v2) });
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "other", files: manifest(other) });
    const before = (await readCloudSave(pool, userId)).usage.bytes;

    const result = await deleteCloudSkills(pool, store, { userId, skillKey: "Notes" });
    assert.equal(result.deletedSkills, 1);
    assert.equal(result.pendingFiles, 0);
    const state = await readCloudSave(pool, userId);
    assert.deepEqual(state.skills.map((skill) => skill.key), ["other"]);
    assert.deepEqual(state.settings, { enabled: true, excludedSkillKeys: ["notes"] });
    assert.equal(state.usage.bytes, before - result.freedBytes);
    // SKILL.md v1 is shared with "other" and stays; run.sh and SKILL.md v2 go.
    const hasBlob = (text: string) => [...store.objects.keys()].some((key) => key.startsWith(`cloud/${userId}/${gitObjectSha("blob", Buffer.from(text))}/`));
    assert.ok(hasBlob(v1[0].text));
    assert.ok(!hasBlob(v1[1].text));
    assert.ok(!hasBlob(v2[0].text));
    await rejects(listCloudVersions(pool, { userId, skillKey: "notes" }), "not_found");
    await rejects(saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) }), "excluded");
  });
});

test("deleting everything removes all saved skills, files and reviews, and turns cloud save off", async () => {
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    const other = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await updateCloudSaveSettings(pool, other.userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await uploadAll(pool, store, other.userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    await saveCloudVersion(pool, { ...other, skillKey: "notes", files: manifest(v1) });
    const secret = Buffer.from(`TOKEN=${fakeToken}\n`);
    await assert.rejects(storeCloudBlob(pool, store, { userId, deviceId, blobSha: gitObjectSha("blob", secret), data: secret }));

    const result = await deleteCloudSkills(pool, store, { userId });
    assert.equal(result.deletedSkills, 1);
    const state = await readCloudSave(pool, userId);
    assert.deepEqual(state.skills, []);
    assert.equal(state.usage.bytes, 0);
    assert.equal(state.settings.enabled, false);
    assert.deepEqual([...store.objects.keys()].filter((key) => key.includes(userId)), []);
    const holds = await pool.query("SELECT 1 FROM cloud_secret_holds WHERE user_id = $1", [userId]);
    assert.equal(holds.rowCount, 0);
    // Another user's copy is untouched.
    assert.equal((await readCloudSave(pool, other.userId)).skills.length, 1);
    assert.equal([...store.objects.keys()].filter((key) => key.includes(other.userId)).length, 2);
  });
});

test("files that fail to delete are retried, and a file stored again is never removed", async () => {
  const { deleteCloudSkills, drainCloudPurge } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    const keys = [...store.objects.keys()];
    store.failing = new Set(keys);

    const result = await deleteCloudSkills(pool, store, { userId, skillKey: "notes" });
    assert.equal(result.pendingFiles, 2);
    assert.equal(store.objects.size, 2);

    // Failed files wait an hour before the next try.
    store.failing = new Set();
    assert.equal(await drainCloudPurge(pool, store, userId), 2);
    assert.equal(store.objects.size, 2);
    const retry = await pool.query<{ attempts: number }>("SELECT attempts FROM cloud_storage_purge_queue WHERE user_id = $1", [userId]);
    assert.deepEqual(retry.rows.map((row) => row.attempts), [1, 1]);

    // One file comes back before the clean-up runs again: its new copy must stay.
    await updateCloudSaveSettings(pool, userId, { excludedSkillKeys: [] });
    await uploadAll(pool, store, userId, [v1[0]]);
    await pool.query("UPDATE cloud_storage_purge_queue SET not_before = now() WHERE user_id = $1", [userId]);
    assert.equal(await drainCloudPurge(pool, store, userId), 0);
    assert.equal(store.objects.size, 1);
    assert.ok([...store.objects.keys()][0].startsWith(`cloud/${userId}/${gitObjectSha("blob", Buffer.from(v1[0].text))}/`));
  });
});

test("versions of shared and GitHub sources stay append-only, even inside a cloud delete", async () => {
  await withMigratedSchema(async (pool) => {
    const { userId, deviceId } = await createUser(pool);
    const store = new MemoryStore();
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    const source = await pool.query<{ id: string }>(
      "INSERT INTO skill_sources (kind, normalized_root, catalog_skill_id) VALUES ('catalog', '.', 'a/b:c') RETURNING id");
    await pool.query(
      "INSERT INTO skill_releases (source_id, commit_sha, tree_sha, skill_md_sha, created_by) VALUES ($1, $2, $2, $2, 'x')",
      [source.rows[0].id, "a".repeat(40)]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL omgskills.cloud_purge = 'on'");
      await assert.rejects(client.query("DELETE FROM skill_releases WHERE source_id = $1", [source.rows[0].id]), /append-only/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    // Without the delete flag, cloud versions can't be removed either.
    await assert.rejects(pool.query("DELETE FROM cloud_releases"), /append-only/);
    await assert.rejects(pool.query("DELETE FROM skill_sources WHERE kind = 'cloud'"), /tombstoned/);
  });
});

test("reading cloud save does no clean-up work, and the hourly run finishes a delete", async () => {
  const { portalCloudSave } = await import("../portal-cloud-save.mjs");
  const { deleteCloudSkills } = await import("./cloud-save.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    store.failing = new Set(store.objects.keys());
    assert.equal((await deleteCloudSkills(pool, store, { userId })).pendingFiles, 2);
    store.failing = new Set();

    const read = await portalCloudSave(new Request("https://omgskills.com/api/portal/cloud-save"), {} as never, {
      available: () => true, pool: () => pool, store: () => { throw new Error("reads must not use storage"); },
      requireUser: async () => ({ userId, deviceId: null }), requireDevice: async () => ({ userId, deviceId })
    } as never);
    assert.equal(read.status, 200);
    assert.equal(store.objects.size, 2);

    await pool.query("UPDATE cloud_storage_purge_queue SET not_before = now() - interval '1 second'");
    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.purged.deleted, 2);
    assert.equal(store.objects.size, 0);
    assert.equal((await pool.query("SELECT 1 FROM cloud_storage_purge_queue")).rowCount, 0);
  });
});

test("deleting a skill works even when the left-out list is full", async () => {
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    await updateCloudSaveSettings(pool, userId, { excludedSkillKeys: Array.from({ length: 5000 }, (_, index) => `skill-${index}`) });
    assert.equal((await deleteCloudSkills(pool, store, { userId, skillKey: "notes" })).deletedSkills, 1);
    assert.deepEqual((await readCloudSave(pool, userId)).skills, []);
  });
});

test("a version save that lands during a delete asks for its files again instead of saving a broken version", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    // Files disappear after the save's first check, just as its transaction begins.
    const racingPool = {
      query: (text: string, values?: unknown[]) => pool.query(text, values),
      async connect() {
        const client = await pool.connect();
        const query = client.query;
        client.query = (async (text: string, values?: unknown[]) => {
          client.query = query;
          if (text === "BEGIN") await pool.query("DELETE FROM cloud_blobs WHERE user_id = $1", [userId]);
          return client.query(text, values);
        }) as typeof client.query;
        return client;
      }
    } as unknown as Pool;
    const result = await saveCloudVersion(racingPool, { userId, deviceId, skillKey: "beta", files: manifest(v1) });
    assert.equal(result.status, "missing_files");
    assert.equal(result.status === "missing_files" && result.missing.length, 2);
    assert.deepEqual((await readCloudSave(pool, userId)).skills, []);
  });
});

test("deleting one skill keeps files just uploaded for another skill", async () => {
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "alpha", files: manifest(v1) });
    const beta: File[] = [{ path: "SKILL.md", text: "# Beta\n" }];
    await uploadAll(pool, store, userId, beta);
    await deleteCloudSkills(pool, store, { userId, skillKey: "alpha" });
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "beta", files: manifest(beta) });
    assert.equal(saved.status, "saved");
    assert.ok([...store.objects.keys()].some((key) => key.startsWith(`cloud/${userId}/${gitObjectSha("blob", Buffer.from(beta[0].text))}/`)));
  });
});

test("legacy files still load and delete", async () => {
  const { cloudBlobKey } = await import("./cloud-store.js");
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    for (const file of v1) {
      const data = Buffer.from(file.text), sha = gitObjectSha("blob", data);
      await store.put(cloudBlobKey(userId, sha), data);
      await pool.query("INSERT INTO cloud_blobs (user_id, blob_sha, byte_size, labels) VALUES ($1, $2, $3, ARRAY[]::text[])", [userId, sha, data.length]);
    }
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.equal(saved.status, "saved");
    if (saved.status !== "saved") throw new Error("save failed");
    const loaded = await loadCloudVersionPackage(pool, store, { userId, releaseId: saved.skill.currentVersion.id });
    assert.deepEqual(loaded.package.entries.map((entry) => entry.data.toString()), v1.map((file) => file.text));
    await deleteCloudSkills(pool, store, { userId });
    assert.equal(store.objects.size, 0);
  });
});

test("a late delete only removes the old upload, never its replacement", async () => {
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    const oldKeys = [...store.objects.keys()];
    store.failing = new Set(oldKeys);
    await deleteCloudSkills(pool, store, { userId, skillKey: "notes" });
    await updateCloudSaveSettings(pool, userId, { excludedSkillKeys: [] });
    await uploadAll(pool, store, userId, v1);
    const saved = await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    assert.equal(saved.status, "saved");
    const newKeys = [...store.objects.keys()].filter((key) => !oldKeys.includes(key));
    assert.equal(newKeys.length, 2);
    store.failing.clear();
    await store.deleteMany(oldKeys);
    assert.ok(newKeys.every((key) => store.objects.has(key)));
    if (saved.status !== "saved") throw new Error("save failed");
    const loaded = await loadCloudVersionPackage(pool, store, { userId, releaseId: saved.skill.currentVersion.id });
    assert.equal(loaded.package.entries.length, 2);
  });
});

test("the sweep removes a late upload and keeps saved files, then delete-all leaves nothing", async () => {
  const { cloudBlobKey } = await import("./cloud-store.js");
  const { deleteCloudSkills } = await import("./cloud-save.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    const lateData = Buffer.from("late upload");
    const lateKey = `${cloudBlobKey(userId, gitObjectSha("blob", lateData))}/${randomUUID()}`;
    await store.put(lateKey, lateData);
    for (const key of store.objects.keys()) store.modified.set(key, new Date(Date.now() - 7200000));
    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.queued, 1);
    assert.equal(result.purged.deleted, 1);
    assert.equal(store.objects.has(lateKey), false);
    assert.equal(store.objects.size, 2);
    await deleteCloudSkills(pool, store, { userId });
    assert.equal(store.objects.size, 0);
  });
});

test("an upload during a sweep is kept and later pages are processed", async () => {
  const { cloudBlobKey } = await import("./cloud-store.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    for (let i = 0; i < 25; i++) {
      const data = Buffer.from(`orphan ${i}`);
      const key = `${cloudBlobKey(userId, gitObjectSha("blob", data))}/${randomUUID()}`;
      await store.put(key, data);
      store.modified.set(key, new Date(Date.now() - 7200000));
    }
    let added = false;
    const list = store.listCloudObjects.bind(store);
    store.listCloudObjects = async (token, limit) => {
      const page = await list(token, limit);
      if (!added) { added = true; await uploadAll(pool, store, userId, v1); }
      return page;
    };
    await sweepCloudStorage(pool, store);
    await sweepCloudStorage(pool, store);
    assert.equal(store.objects.size, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM cloud_blobs WHERE user_id = $1", [userId])).rows[0].count, 2);
  });
});

test("the sweep removes untracked files after an account is gone", async () => {
  const { cloudBlobKey } = await import("./cloud-store.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const userId = randomUUID(), data = Buffer.from("leftover");
    const key = `${cloudBlobKey(userId, gitObjectSha("blob", data))}/${randomUUID()}`;
    await store.put(key, data);
    store.modified.set(key, new Date(Date.now() - 7200000));
    await sweepCloudStorage(pool, store);
    assert.equal(store.objects.size, 0);
  });
});

const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

async function putOrphan(store: MemoryStore, userId: string, text: string) {
  const { cloudBlobKey } = await import("./cloud-store.js");
  const data = Buffer.from(text);
  const key = `${cloudBlobKey(userId, gitObjectSha("blob", data))}/${randomUUID()}`;
  await store.put(key, data);
  store.modified.set(key, twoHoursAgo());
  return key;
}

test("an upload still under way is never removed, even if its file looks old", async () => {
  const { reserveStorageKeys } = await import("./cloud-storage-purge.js");
  const { drainCloudPurge } = await import("./cloud-save.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId } = await createUser(pool);
    const key = await putOrphan(store, userId, "in flight");
    await reserveStorageKeys(pool, userId, [key]);
    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.queued, 0, "already reserved");
    assert.equal(await drainCloudPurge(pool, store, userId), 1);
    assert.ok(store.objects.has(key));
  });
});

test("a crashed upload's files are removed once its reservation runs out", async () => {
  const { reserveStorageKeys } = await import("./cloud-storage-purge.js");
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId } = await createUser(pool);
    const key = await putOrphan(store, userId, "crashed");
    await reserveStorageKeys(pool, userId, [key]);
    await sweepCloudStorage(pool, store);
    assert.ok(store.objects.has(key), "kept for the hour");
    await pool.query("UPDATE cloud_storage_purge_queue SET not_before = now() - interval '1 second'");
    assert.equal((await sweepCloudStorage(pool, store)).purged.deleted, 1);
    assert.equal(store.objects.has(key), false);
  });
});

test("a file that keeps failing to delete never holds up the others", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const userId = randomUUID();
    const bad = await putOrphan(store, userId, "bad");
    store.failing.add(bad);
    let result = await sweepCloudStorage(pool, store);
    assert.equal(result.purged.failed, 1);
    for (let i = 0; i < 3; i++) await putOrphan(store, userId, `good ${i}`);
    await pool.query("UPDATE cloud_storage_purge_queue SET not_before = now() - interval '1 second'");
    // The scan position wrapped after the full pass; the next run starts a new one.
    result = await sweepCloudStorage(pool, store);
    assert.equal(result.purged.deleted, 3);
    assert.deepEqual([...store.objects.keys()], [bad]);
    const row = await pool.query<{ attempts: number; last_error: string }>("SELECT attempts, last_error FROM cloud_storage_purge_queue");
    assert.deepEqual(row.rows, [{ attempts: 2, last_error: "delete failed" }]);
  });
});

test("storage being down stops a run without losing queued files", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    await putOrphan(store, randomUUID(), "waiting");
    store.deleteMany = async () => { throw new CloudStoreError("unavailable", "down"); };
    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.purged.storageDown, true);
    assert.equal(store.objects.size, 1);
    const row = await pool.query<{ last_error: string }>("SELECT last_error FROM cloud_storage_purge_queue");
    assert.deepEqual(row.rows, [{ last_error: "storage unavailable" }]);
  });
});

test("only one sweep runs at a time, and a crashed run's lease runs out by itself", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const key = await putOrphan(store, randomUUID(), "orphan");
    const list = store.listCloudObjects.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let listing!: () => void;
    const listed = new Promise<void>((resolve) => { listing = resolve; });
    store.listCloudObjects = async (token, limit) => { listing(); await gate; return list(token, limit); };
    const first = sweepCloudStorage(pool, store);
    await listed;
    assert.equal((await sweepCloudStorage(pool, store)).skippedRun, true);
    release();
    assert.equal((await first).purged.deleted, 1);
    assert.equal(store.objects.has(key), false);

    // A run that died while holding the lease: the next run waits for it to run out.
    store.listCloudObjects = list;
    await pool.query("UPDATE cloud_storage_sweep_cursor SET lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute'");
    assert.equal((await sweepCloudStorage(pool, store)).skippedRun, true);
    await pool.query("UPDATE cloud_storage_sweep_cursor SET lease_until = now() - interval '1 second'");
    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.skippedRun, false);
    assert.equal(result.passComplete, true);
    const cursor = await pool.query("SELECT lease_token, last_pass_completed_at IS NOT NULL AS done FROM cloud_storage_sweep_cursor");
    assert.deepEqual(cursor.rows, [{ lease_token: null, done: true }]);
  });
});

test("a run that runs out of time carries on from the same place next hour", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const userId = randomUUID();
    for (let i = 0; i < 30; i++) await putOrphan(store, userId, `orphan ${i}`);
    const list = store.listCloudObjects.bind(store);
    let calls = 0;
    store.listCloudObjects = async (token, limit) => {
      calls += 1;
      // Each page uses up the run's time.
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 60));
      return list(token, limit);
    };
    const first = await sweepCloudStorage(pool, store, { pageSize: 10, budgetMs: 50 });
    assert.equal(first.scanned, 10);
    assert.equal(first.passComplete, false);
    const second = await sweepCloudStorage(pool, store, { pageSize: 10 });
    assert.equal(second.scanned, 20, "starts after the saved page");
    assert.equal(second.passComplete, true);
    assert.equal(store.objects.size, 0);
  });
});

test("the sweep handles thousands of files in a handful of database calls", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  const { storeCloudBlobs } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    const kept = Array.from({ length: 200 }, (_, i) => {
      const data = Buffer.from(`kept ${i}`);
      return { blobSha: gitObjectSha("blob", data), data };
    });
    await storeCloudBlobs(pool, store, { userId, deviceId, files: kept });
    for (const key of store.objects.keys()) store.modified.set(key, twoHoursAgo());
    for (let i = 0; i < 4800; i++) await putOrphan(store, userId, `orphan ${i}`);

    // Counts every statement sent on any connection the pool hands out.
    let queries = 0;
    const counted = new WeakSet<object>();
    pool.on("acquire", (client) => {
      if (counted.has(client)) return;
      counted.add(client);
      const clientQuery = client.query.bind(client);
      client.query = ((...args: Parameters<typeof client.query>) => { queries += 1; return clientQuery(...args); }) as typeof client.query;
    });

    const result = await sweepCloudStorage(pool, store);
    assert.equal(result.scanned, 5000);
    assert.equal(result.queued, 4800);
    assert.equal(result.purged.deleted, 4800);
    assert.equal(store.objects.size, 200);
    assert.ok(queries < 60, `used ${queries} database calls`);
  });
});

test("the old clean-up queue moves over, leaving out files still in use", async () => {
  const { sweepCloudStorage } = await import("./cloud-storage-sweep.js");
  const userId = randomUUID();
  const live = "a".repeat(40), dead = "b".repeat(40);
  await withMigratedSchema(async (pool) => {
    const queue = await pool.query<{ storage_key: string; due: boolean }>(
      "SELECT storage_key, not_before <= now() AS due FROM cloud_storage_purge_queue ORDER BY storage_key");
    assert.deepEqual(queue.rows, [{ storage_key: `cloud/${userId}/${dead}`, due: true }, { storage_key: `cloud/${userId}/reserved`, due: false }]);
    assert.equal((await pool.query("SELECT 1 FROM cloud_purge_queue")).rowCount, 0);

    const store = new MemoryStore();
    for (const sha of [live, dead]) {
      await store.put(`cloud/${userId}/${sha}`, Buffer.from(sha));
      store.modified.set(`cloud/${userId}/${sha}`, twoHoursAgo());
    }
    await sweepCloudStorage(pool, store);
    assert.deepEqual([...store.objects.keys()], [`cloud/${userId}/${live}`]);
  }, undefined, {
    name: "20261103180000_cloud_storage_cleanup",
    run: async (client) => {
      await client.query("INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3)", [userId, `cloud-${userId}`, `${userId}@example.com`]);
      await client.query("INSERT INTO cloud_blobs (user_id, blob_sha, byte_size, labels) VALUES ($1, $2, 1, ARRAY[]::text[])", [userId, live]);
      await client.query("INSERT INTO cloud_purge_queue (user_id, blob_sha, queued_at) VALUES ($1, $2, now() - interval '2 hours'), ($1, $3, now() - interval '2 hours')", [userId, live, dead]);
      await client.query("INSERT INTO cloud_storage_purge_queue (user_id, storage_key) VALUES ($1, $2)", [userId, `cloud/${userId}/reserved`]);
    }
  });
});

test("each Mac reports why it didn't save skills, and its next report replaces the last", async () => {
  const { portalCloudSave } = await import("../portal-cloud-save.mjs");
  await withMigratedSchema(async (pool) => {
    const { userId, deviceId } = await createUser(pool);
    const other = (await pool.query<{ id: string }>(
      `INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at, granted_scopes)
       VALUES ($1, $2, 'Mac 2', now() + interval '1 day', ARRAY['sync:write', 'self:revoke', 'content:read', 'content:write']) RETURNING id`,
      [userId, `hash-2-${userId}`]
    )).rows[0].id;
    let mac = deviceId;
    const dependencies = {
      available: () => true,
      pool: () => pool,
      store: () => new MemoryStore(),
      requireUser: async () => ({ userId, deviceId: null }),
      requireDevice: async () => ({ userId, deviceId: mac })
    };
    const device = { authorization: `Bearer device_${"a".repeat(43)}` };
    const report = (skipped: unknown, headers: Record<string, string> = device) =>
      portalCloudSave(new Request("https://omgskills.com/api/portal/cloud-save/skipped",
        { method: "PUT", body: JSON.stringify({ skipped }), headers }), {} as never, dependencies as never);

    assert.equal((await report({ "Ship": "links", pdf: "library", big: "too_large" })).status, 204);
    mac = other;
    assert.equal((await report({ pdf: "failed" })).status, 204);
    assert.deepEqual((await readCloudSave(pool, userId)).skipped, { ship: "links", pdf: "failed", big: "too_large" });

    mac = deviceId;
    assert.equal((await report({ ship: "links" })).status, 204);
    assert.deepEqual((await readCloudSave(pool, userId)).skipped, { pdf: "failed", ship: "links" });

    // One odd folder name or a reason from a newer Mac drops only that entry.
    assert.equal((await report({ ship: "links", ".hidden": "links", "a/b": "failed", new: "because" })).status, 204);
    assert.deepEqual((await readCloudSave(pool, userId)).skipped, { pdf: "failed", ship: "links" });
    assert.equal((await report(["ship"])).status, 400);
    assert.equal((await report(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`s${i}`, "links"])))).status, 400);
    // A web session can't report for a Mac.
    const web = await portalCloudSave(new Request("https://omgskills.com/api/portal/cloud-save/skipped",
      { method: "PUT", body: JSON.stringify({ skipped: {} }) }), {} as never,
      { ...dependencies, requireDevice: async () => { throw new Response("no", { status: 401 }); } } as never);
    assert.equal(web.status, 401);
  });
});

test("someone invited to a Set downloads the owner's saved version; nobody else does", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const owner = await createUser(pool);
    const member = await createUser(pool);
    const stranger = await createUser(pool);
    const email = async (userId: string) =>
      (await pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId])).rows[0].email;
    await updateCloudSaveSettings(pool, owner.userId, { enabled: true });
    await uploadAll(pool, store, owner.userId, v1);
    const saved = await saveCloudVersion(pool, { ...owner, skillKey: "notes", files: manifest(v1) });
    assert.ok(saved.status === "saved");
    const releaseId = saved.skill.currentVersion.id;
    const sourceId = (await pool.query<{ id: string }>("SELECT source_id AS id FROM skill_releases WHERE id = $1", [releaseId])).rows[0].id;

    const asMember = { userId: member.userId, email: await email(member.userId), deviceId: member.deviceId };
    // Not in any Set yet: only the owner can read it.
    await assert.rejects(requirePrivateReleaseAccess(pool, asMember, releaseId));
    const ownerGrant = await requirePrivateReleaseAccess(pool, { userId: owner.userId, email: await email(owner.userId) }, releaseId);
    assert.equal(ownerGrant.sourceKind, "cloud");

    const group = (await pool.query<{ id: string }>(
      "INSERT INTO skill_groups (owner_user_id, name, slug, visibility) VALUES ($1, 'Team', 'team', 'restricted') RETURNING id",
      [owner.userId])).rows[0].id;
    await pool.query(
      "INSERT INTO skill_group_items (group_id, kind, name, source_id, release_id, position) VALUES ($1, 'synced', 'notes', $2, $3, 0)",
      [group, sourceId, releaseId]);
    await pool.query("INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, $2)", [group, asMember.email]);

    const grant = await requirePrivateReleaseAccess(pool, asMember, releaseId);
    assert.equal(grant.accessRole, "invited");
    assert.equal(grant.groupId, group);
    const shared = await loadSharedCloudPackage(pool, store, grant);
    assert.deepEqual(shared.entries.map((entry) => entry.path).sort(), ["SKILL.md", "scripts/run.sh"]);
    assert.equal(shared.coordinates.treeSha, grant.treeSha);

    // Not invited, or the Set made public: no access.
    await assert.rejects(requirePrivateReleaseAccess(pool, { userId: stranger.userId, email: await email(stranger.userId) }, releaseId));
    await pool.query("UPDATE skill_groups SET visibility = 'public' WHERE id = $1", [group]);
    await assert.rejects(requirePrivateReleaseAccess(pool, asMember, releaseId));
    await pool.query("UPDATE skill_groups SET visibility = 'restricted' WHERE id = $1", [group]);

    // A version the owner confirmed has a key is never shared, even if it ends up in the Set.
    const keyed: File[] = [{ path: "SKILL.md", text: "---\nname: keys\ndescription: Keys.\n---\n" }, { path: "config.env", text: `TOKEN=${fakeToken}\n` }];
    for (const file of keyed) {
      const data = Buffer.from(file.text);
      await storeCloudBlob(pool, store, { userId: owner.userId, blobSha: gitObjectSha("blob", data), data, confirmSecrets: true });
    }
    const keyedSave = await saveCloudVersion(pool, { ...owner, skillKey: "keys", files: manifest(keyed) });
    assert.ok(keyedSave.status === "saved" && keyedSave.skill.currentVersion.labels.includes("confirmed_secret"));
    const keyedRelease = keyedSave.skill.currentVersion.id;
    const keyedSource = (await pool.query<{ id: string }>("SELECT source_id AS id FROM skill_releases WHERE id = $1", [keyedRelease])).rows[0].id;
    await pool.query(
      "INSERT INTO skill_group_items (group_id, kind, name, source_id, release_id, position) VALUES ($1, 'synced', 'keys', $2, $3, 1)",
      [group, keyedSource, keyedRelease]);
    await assert.rejects(requirePrivateReleaseAccess(pool, asMember, keyedRelease));

    // A grant can't be pointed at someone else's storage.
    await rejects(loadSharedCloudPackage(pool, store, { ...grant, ownerUserId: stranger.userId }), "not_found");
    await rejects(loadSharedCloudPackage(pool, store, { ...grant, treeSha: "0".repeat(40) }), "not_found");
  });
});
