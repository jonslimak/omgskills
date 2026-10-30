import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageNetlifyDbMigrations } from "./stage-netlify-db-migrations.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "omgskills-netlify-migrations-"));
  const sourceDir = path.join(root, "source");
  const destinationDir = path.join(root, "destination");
  await mkdir(path.join(sourceDir, "20260101000000_first"), { recursive: true });
  await mkdir(path.join(sourceDir, "20260102000000_second"), { recursive: true });
  await writeFile(
    path.join(sourceDir, "20260101000000_first", "migration.sql"),
    "SELECT 1;\n",
  );
  await writeFile(
    path.join(sourceDir, "20260102000000_second", "migration.sql"),
    "SELECT 2;\n",
  );
  return { root, sourceDir, destinationDir };
}

test("stages exact Netlify migration directories and removes stale output", async (t) => {
  const { root, sourceDir, destinationDir } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(destinationDir, "20250101000000_stale"), { recursive: true });
  await writeFile(
    path.join(destinationDir, "20250101000000_stale", "migration.sql"),
    "SELECT 0;\n",
  );

  const migrations = await stageNetlifyDbMigrations({ sourceDir, destinationDir });

  assert.deepEqual(migrations, ["20260101000000_first", "20260102000000_second"]);
  assert.deepEqual(await readdir(destinationDir), migrations);
  assert.equal(
    await readFile(
      path.join(destinationDir, "20260102000000_second", "migration.sql"),
      "utf8",
    ),
    "SELECT 2;\n",
  );
});

test("rejects a migration directory without migration.sql", async (t) => {
  const { root, sourceDir, destinationDir } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(sourceDir, "20260103000000_missing"));

  await assert.rejects(
    stageNetlifyDbMigrations({ sourceDir, destinationDir }),
    /Missing migration\.sql.*20260103000000_missing/,
  );
});

test("merged release stages all reviewed migrations without changing their SQL", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omgskills-bridge-migrations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = new URL("../netlify/database/migrations/", import.meta.url);
  const expected = [
    "20260623180000_create_skill_groups", "20260708120000_add_sync_identity_fields",
    "20260708123000_add_group_item_snapshots", "20260711110000_enforce_sync_identity_consistency",
    "20260712100000_add_device_tokens", "20260827150000_add_shared_skill_release_storage",
    "20260827203000_add_github_broker_installations", "20260828150000_add_content_fetch_audit",
    "20260901170000_add_device_token_scopes",
    "20261016120000_add_device_inventory", "20261016130000_add_inventory_reconciliation",
    "20261016140000_add_inventory_check_time", "20261021170000_add_device_reconnect_key",
    "20261030170000_add_inventory_set_origin",
  ];
  const destinationDir = path.join(root, "staged");
  assert.deepEqual(await stageNetlifyDbMigrations({ destinationDir }), expected);
  assert.deepEqual((await readdir(destinationDir)).sort(), expected);
  for (const name of expected) {
    assert.deepEqual(await readFile(path.join(destinationDir, name, "migration.sql")),
      await readFile(new URL(name + "/migration.sql", sourceDir)));
  }
});
