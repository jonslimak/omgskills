import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import pg from "pg";
import { connectionString, state, verifyDatabase } from "./local-environment.mjs";

const file = `${state}/unified-fixture.json`;
const db = new pg.Client({ connectionString: connectionString() });
await db.connect();
try {
  await verifyDatabase(db);
  if (process.argv[2] === "seed") {
    const users = await db.query("SELECT id FROM users");
    assert.equal(users.rowCount, 1, "Fixture requires exactly one signed-in test account");
    assert.equal((await db.query("SELECT id FROM synced_skills")).rowCount, 0, "Do not mix fixtures with existing skills");
    const run = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await writeFile(file, JSON.stringify({ run, ids }), { flag: "wx", mode: 0o600 });
    await db.query("BEGIN");
    try {
      await db.query("INSERT INTO sync_runs(id,user_id,status) VALUES ($1,$2,'completed')", [run, users.rows[0].id]);
      for (let i = 0; i < ids.length; i++) {
        await db.query(`INSERT INTO synced_skills (id,user_id,sync_run_id,stable_key,name,description,catalog_skill_id,github_url,is_local_only,source,identity_status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10)`,
        [ids[i], users.rows[0].id, run, `unified-browser-fixture:${ids[i]}`, i < 2 ? "Test design skill" : "Test private workflow",
          "Temporary local browser-test fixture", i < 2 ? "unified-test/design" : null, i === 2, i === 1 ? "codex" : "claude", i < 2 ? "resolved" : "localOnly"]);
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); await unlink(file); throw error; }
    console.log("Added three clearly labeled local test installs (two grouped skills). No external account/data changed.");
  } else if (process.argv[2] === "cleanup") {
    const { run, ids } = JSON.parse(await readFile(file, "utf8"));
    assert.ok(Array.isArray(ids) && ids.length === 3);
    await db.query("BEGIN");
    await db.query("DELETE FROM synced_skills WHERE id=ANY($1::uuid[]) AND sync_run_id=$2 AND stable_key LIKE 'unified-browser-fixture:%'", [ids, run]);
    await db.query("DELETE FROM sync_runs WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM synced_skills WHERE sync_run_id=$1)", [run]);
    await db.query("COMMIT");
    await unlink(file);
    console.log("Removed only the temporary browser-test records.");
  } else throw new Error("Use seed or cleanup");
} finally { await db.end(); }
