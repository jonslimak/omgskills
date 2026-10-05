import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile, lstat, realpath, chmod } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";
import {
  root, state, directory, database, socket, port, pgBin, backendOrigin,
  connectionString, cleanEnvironment, verifyDatabase, developmentKeys, verifyClerk,
} from "./local-environment.mjs";

const env = cleanEnvironment();
function pgCommand(command, args) {
  const result = spawnSync(path.join(pgBin, command), args, { env, stdio: "inherit" });
  assert.equal(result.status, 0, `${command} failed`);
}
async function privateDirectory(location) {
  await mkdir(location, { recursive: true, mode: 0o700 });
  const info = await lstat(location);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid(), "Unsafe local directory");
  await chmod(location, 0o700);
}
async function client(name = database) {
  const connection = new pg.Client({ connectionString: connectionString(name), connectionTimeoutMillis: 3000 });
  await connection.connect();
  try { await verifyDatabase(connection, name); } catch (error) { await connection.end(); throw error; }
  return connection;
}
async function startDatabase() {
  assert.equal(await realpath(directory), directory);
  const status = spawnSync(path.join(pgBin, "pg_ctl"), ["-D", directory, "status"], { env, stdio: "ignore" });
  if (status.status === 3) {
    await privateDirectory(socket);
    pgCommand("pg_ctl", ["-D", directory, "-l", path.join(state, "postgres.log"), "-w", "start",
      "-o", `-h '' -k '${socket}' -p ${port} -c unix_socket_permissions=0700`]);
  } else assert.equal(status.status, 0, "Cannot determine local database status");
}
async function migrations(connection) {
  const location = path.join(root, "netlify/database/migrations");
  await connection.query("BEGIN");
  try {
    await connection.query("CREATE TABLE IF NOT EXISTS local_test_migrations (name text PRIMARY KEY, sha text NOT NULL)");
    for (const name of (await readdir(location)).sort()) {
      const sql = await readFile(path.join(location, name, "migration.sql"), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const existing = await connection.query("SELECT sha FROM local_test_migrations WHERE name=$1", [name]);
      if (existing.rowCount) { assert.equal(existing.rows[0].sha, sha, `Migration changed: ${name}`); continue; }
      await connection.query(sql);
      await connection.query("INSERT INTO local_test_migrations VALUES ($1,$2)", [name, sha]);
    }
    await connection.query("COMMIT");
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
}
function runNode(args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extra }, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", code => { process.exitCode = code ?? 1; });
}

async function main() {
  const command = process.argv[2];
  if (command === "setup" || command === "migrate") {
    await privateDirectory(state);
    await privateDirectory(socket);
    // Never replace an existing database or credentials, including a partial setup.
    if (command === "setup") {
      await mkdir(directory, { mode: 0o700 });
      pgCommand("initdb", ["-D", directory, "--auth-local=peer", "--auth-host=reject", "--encoding=UTF8", "--locale=C"]);
    }
    await startDatabase();
    const admin = await client("postgres");
    try {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
      if (!exists.rowCount) await admin.query(`CREATE DATABASE ${database}`);
    } finally { await admin.end(); }
    const connection = await client();
    try { await migrations(connection); } finally { await connection.end(); }
    try {
      await writeFile(path.join(state, "clerk.env"), "VITE_CLERK_PUBLISHABLE_KEY=\nCLERK_SECRET_KEY=\n", { flag: "wx", mode: 0o600 });
    } catch (error) { if (error.code !== "EEXIST") throw error; }
    console.log("Isolated database ready with repository migrations. No production data imported.");
    return;
  }
  if (command === "start-db") { await startDatabase(); const c = await client(); await c.end(); return; }
  if (command === "stop-db") {
    const c = await client(); await c.end();
    pgCommand("pg_ctl", ["-D", directory, "-w", "stop", "-m", "fast"]); return;
  }
  if (command === "status") {
    const c = await client();
    try {
      const { rows: [counts] } = await c.query("SELECT (SELECT count(*) FROM local_test_migrations)::int AS migrations, (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM synced_skills)::int AS skills");
      console.log(JSON.stringify({ database, directory, tcp: false, ...counts }));
    } finally { await c.end(); }
    try { await developmentKeys(); console.log("Development keys configured; instance matching still needs network verification."); }
    catch { console.log("Development keys missing or invalid; sign-in remains disabled."); }
    return;
  }
  if (command === "backend") {
    const c = await client(); await c.end();
    const keys = await developmentKeys();
    await verifyClerk(keys);
    runNode(["--import", "tsx", "portal/testing/local-read-server.mts"], {
      CONTEXT: "dev", SKILLGROUPS_DATABASE_URL: connectionString(),
      VITE_CLERK_PUBLISHABLE_KEY: keys.publicKey, CLERK_SECRET_KEY: keys.secretKey,
    });
    return;
  }
  if (command === "frontend") {
    const keys = await developmentKeys();
    await verifyClerk(keys);
    const health = await fetch(`${backendOrigin}/health`, { signal: AbortSignal.timeout(3000), redirect: "error" });
    assert.equal(health.status, 200);
    const ready = await health.json();
    assert.equal(ready.database, database); assert.equal(ready.readOnly, true); assert.equal(ready.clerkFrontend, keys.frontend);
    runNode(["node_modules/vite/bin/vite.js", "portal", "--host", "127.0.0.1", "--port", "5191", "--strictPort"], {
      VITE_PORTAL_INTEGRATION: "1", VITE_SKILLGROUPS_WEB_ENABLED: "1",
      VITE_CLERK_PUBLISHABLE_KEY: keys.publicKey, PORTAL_TEST_API_ORIGIN: backendOrigin,
      PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", PORTAL_PUBLIC_CATALOG_PROXY: "1",
    });
    return;
  }
  throw new Error("Use setup, migrate, start-db, stop-db, status, backend, or frontend.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
