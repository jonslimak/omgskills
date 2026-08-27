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
