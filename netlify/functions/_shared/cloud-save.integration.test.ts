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
  failing = new Set<string>();
  async deleteMany(keys: string[]) {
    for (const key of keys) if (!this.failing.has(key)) this.objects.delete(key);
    return keys.filter((key) => this.failing.has(key));
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
    const blob = (text: string) => `cloud/${userId}/${gitObjectSha("blob", Buffer.from(text))}`;
    assert.ok(store.objects.has(blob(v1[0].text)));
    assert.ok(!store.objects.has(blob(v1[1].text)));
    assert.ok(!store.objects.has(blob(v2[0].text)));
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

    // One file comes back before the clean-up runs again: it must stay.
    await updateCloudSaveSettings(pool, userId, { excludedSkillKeys: [] });
    await uploadAll(pool, store, userId, [v1[0]]);
    store.failing = new Set();
    assert.equal(await drainCloudPurge(pool, store, userId), 0);
    assert.deepEqual([...store.objects.keys()], [`cloud/${userId}/${gitObjectSha("blob", Buffer.from(v1[0].text))}`]);
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

test("reading cloud save finishes a pending clean-up, and never fails because of it", async () => {
  const { portalCloudSave } = await import("../portal-cloud-save.mjs");
  const { deleteCloudSkills } = await import("./cloud-save.js");
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const { userId, deviceId } = await createUser(pool);
    await updateCloudSaveSettings(pool, userId, { enabled: true });
    await uploadAll(pool, store, userId, v1);
    await saveCloudVersion(pool, { userId, deviceId, skillKey: "notes", files: manifest(v1) });
    store.failing = new Set(store.objects.keys());
    assert.equal((await deleteCloudSkills(pool, store, { userId })).pendingFiles, 2);

    const read = (storeFor: () => MemoryStore) => portalCloudSave(new Request("https://omgskills.com/api/portal/cloud-save"), {} as never, {
      available: () => true, pool: () => pool, store: storeFor,
      requireUser: async () => ({ userId, deviceId: null }), requireDevice: async () => ({ userId, deviceId })
    } as never);
    // Storage unreachable: the read still answers, and the files stay queued.
    assert.equal((await read(() => { throw new Error("not configured"); })).status, 200);
    assert.equal(store.objects.size, 2);
    store.failing = new Set();
    assert.equal((await read(() => store)).status, 200);
    assert.equal(store.objects.size, 0);
    const queued = await pool.query("SELECT 1 FROM cloud_purge_queue WHERE user_id = $1", [userId]);
    assert.equal(queued.rowCount, 0);
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
