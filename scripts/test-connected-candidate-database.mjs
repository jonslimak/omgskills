#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execute = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const pgBin = '/opt/homebrew/opt/postgresql@16/bin';
export const migrations = [
  '20260623180000_create_skill_groups',
  '20260708120000_add_sync_identity_fields',
  '20260708123000_add_group_item_snapshots',
  '20260711110000_enforce_sync_identity_consistency',
  '20260712100000_add_device_tokens',
  '20260827150000_add_shared_skill_release_storage',
  '20260827203000_add_github_broker_installations',
  '20260828150000_add_content_fetch_audit',
  '20260901170000_add_device_token_scopes',
  '20261016120000_add_device_inventory',
  '20261016130000_add_inventory_reconciliation',
  '20261016140000_add_inventory_check_time',
  '20261021170000_add_device_reconnect_key',
];

export function cleanEnvironment() {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C', TMPDIR: '/private/tmp', NODE_ENV: 'test' };
}

export function validateFixture(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Owned fixture is required');
  assert.equal(Object.keys(value).sort().join(','), 'database,password,root,runId,token,user,version', 'Unexpected fixture fields');
  assert.equal(value.version, 1, 'Unknown fixture version');
  assert.match(value.root, /^\/private\/tmp\/og-cc2c-[A-Za-z0-9]{6}$/, 'Only this temporary fixture root is allowed');
  assert.match(value.runId, /^[a-f0-9]{12}$/, 'Invalid run identity');
  assert.equal(value.database, `cc2c_test_${value.runId}`, 'Unexpected test database');
  assert.equal(value.user, value.database, 'Unexpected test role');
  assert.match(value.password, /^[A-Za-z0-9_-]{43}$/, 'Generated password is required');
  assert.match(value.token, /^[A-Za-z0-9_-]{43}$/, 'Runner token is required');
  return value;
}

async function ownedPath(path, directory) {
  const info = await lstat(path);
  assert.ok(directory ? info.isDirectory() : info.isFile(), 'Expected an ordinary owned path');
  assert.equal(info.uid, process.getuid(), 'Fixture must belong to this user');
  assert.equal(info.mode & 0o077, 0, 'Fixture must be owner-only');
  assert.equal(await realpath(path), path, 'Fixture redirects are not allowed');
}

export async function verifyFixtureFiles(fixture) {
  validateFixture(fixture);
  await ownedPath(fixture.root, true);
  const file = join(fixture.root, 'fixture.json');
  await ownedPath(file, false);
  const recorded = validateFixture(JSON.parse(await readFile(file, 'utf8')));
  assert.ok(Object.keys(recorded).every(key => recorded[key] === fixture[key]), 'Fixture ownership record changed');
  for (const name of ['data', 'socket']) {
    const target = join(fixture.root, name);
    try { await ownedPath(target, true); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function readOwnedFixture(file, token) {
  assert.ok(typeof file === 'string' && /^\/private\/tmp\/og-cc2c-[A-Za-z0-9]{6}\/fixture\.json$/.test(file),
    'Run through the owned database runner; no database URL fallback is allowed');
  await ownedPath(dirname(file), true);
  await ownedPath(file, false);
  const fixture = validateFixture(JSON.parse(await readFile(file, 'utf8')));
  assert.equal(file, join(fixture.root, 'fixture.json'), 'Fixture path mismatch');
  assert.ok(typeof token === 'string' && token === fixture.token, 'Runner authorization is required');
  await verifyFixtureFiles(fixture);
  return fixture;
}

export function poolOptions(fixture, database = fixture.database) {
  validateFixture(fixture);
  assert.ok(database === fixture.database || database === 'postgres', 'Only the owned database or bootstrap is allowed');
  return { host: join(fixture.root, 'socket'), port: 55440, user: fixture.user, password: fixture.password,
    database, max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 5000 };
}

export function connectionString(fixture) {
  const options = poolOptions(fixture);
  const url = new URL(`postgresql://${options.user}:${options.password}@localhost/${options.database}`);
  url.searchParams.set('host', options.host);
  url.searchParams.set('port', String(options.port));
  return url.href;
}

export async function verifyDatabase(pool, fixture, database = fixture.database) {
  await verifyFixtureFiles(fixture);
  const expected = poolOptions(fixture, database);
  const { rows: [actual] } = await pool.query(`SELECT current_database() AS database, current_user AS username,
    current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listen,
    current_setting('unix_socket_directories') AS socket, inet_server_addr() AS address`);
  assert.equal(actual.database, expected.database, 'Wrong database');
  assert.equal(actual.username, fixture.user, 'Wrong database role');
  assert.equal(actual.directory, join(fixture.root, 'data'), 'Wrong cluster directory');
  assert.equal(actual.listen, '', 'TCP must be disabled');
  assert.equal(actual.socket, expected.host, 'Wrong cluster socket');
  assert.equal(actual.address, null, 'Connection must use a Unix socket');
  await ownedPath(actual.directory, true);
  await ownedPath(actual.socket, true);
  const hba = await pool.query("SELECT type, auth_method, error FROM pg_hba_file_rules WHERE type='local' OR error IS NOT NULL");
  assert.ok(hba.rows.length > 0 && hba.rows.every(row => row.type === 'local'
    && row.auth_method === 'scram-sha-256' && row.error === null), 'Socket password authentication is required');
  return { database: actual.database, user: actual.username, directory: actual.directory,
    socket: actual.socket, listenAddresses: actual.listen, socketPasswordAuth: true };
}

export async function cleanupOwnedFixture(fixture, operations) {
  await verifyFixtureFiles(fixture);
  if (await operations.isRunning()) await operations.stop();
  assert.equal(await operations.isRunning(), false, 'Cluster is still running; preserve the fixture');
  await verifyFixtureFiles(fixture);
  await operations.remove();
}

export function safeDiagnostic(value, fixture) {
  let text = String(value);
  for (const secret of [fixture.password, fixture.token, connectionString(fixture)]) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:device_|pair_|sk_test_|sk_live_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[redacted database URL]').slice(-12000);
}

async function main() {
  const root = await mkdtemp('/private/tmp/og-cc2c-');
  const runId = randomBytes(6).toString('hex');
  const fixture = { version: 1, root, runId, database: `cc2c_test_${runId}`, user: `cc2c_test_${runId}`,
    password: randomBytes(32).toString('base64url'), token: randomBytes(32).toString('base64url') };
  await writeFile(join(root, 'fixture.json'), JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
  const evidence = await mkdtemp('/private/tmp/og-cc2c-evidence-');
  const result = { checkpoint: 'CC2C1', auth: 'fake verified Clerk identity; no external calls',
    workingDirectory: repo, passed: false, cleanup: false, migrations: [], commands: [] };
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Database proof interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let admin;
  let pool;
  const command = async (binary, args, options = {}) => {
    result.commands.push({ executable: binary, args });
    try { return await execute(binary, args, { cwd: repo, env: cleanEnvironment(), timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, signal: abort.signal, ...options }); }
    catch (error) { throw Error(safeDiagnostic([error.message, error.stdout, error.stderr].filter(Boolean).join('\n'), fixture)); }
  };
  const pgCommand = (name, args, options) => command(join(pgBin, name), args, options);
  const data = join(root, 'data');
  const cleanup = () => cleanupOwnedFixture(fixture, {
    async isRunning() {
      try { await lstat(join(data, 'PG_VERSION')); }
      catch (error) { if (error.code === 'ENOENT') { await assert.rejects(lstat(join(data, 'postmaster.pid')), { code: 'ENOENT' }); return false; } throw error; }
      try { await execute(join(pgBin, 'pg_ctl'), ['-D', data, 'status'], { env: cleanEnvironment(), timeout: 5000 }); return true; }
      catch (error) { if (error.code === 3) return false; throw error; }
    },
    stop: () => pgCommand('pg_ctl', ['-D', data, '-w', '-t', '15', '-m', 'fast', 'stop'], { signal: undefined }),
    remove: () => rm(root, { recursive: true }),
  });
  try {
    await verifyFixtureFiles(fixture);
    await mkdir(join(root, 'socket'), { mode: 0o700 });
    const passwordFile = join(root, 'password');
    await writeFile(passwordFile, fixture.password + '\n', { flag: 'wx', mode: 0o600 });
    await pgCommand('initdb', ['-D', data, '-U', fixture.user, '--pwfile', passwordFile,
      '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--no-locale', '-E', 'UTF8']);
    await rm(passwordFile);
    await pgCommand('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '15', '-o',
      `-c listen_addresses='' -c unix_socket_directories='${join(root, 'socket')}' -c port=55440 -c unix_socket_permissions=0700`, 'start']);
    admin = new pg.Pool(poolOptions(fixture, 'postgres'));
    await verifyDatabase(admin, fixture, 'postgres');
    const wrongPassword = new pg.Client({ ...poolOptions(fixture, 'postgres'), password: 'deliberately-wrong-test-password' });
    try { await assert.rejects(wrongPassword.connect(), { code: '28P01' }); }
    finally { await wrongPassword.end(); }
    result.wrongPasswordRejected = true;
    await admin.query(`CREATE DATABASE "${fixture.database}"`);
    await admin.end(); admin = undefined;
    pool = new pg.Pool(poolOptions(fixture));
    result.identity = await verifyDatabase(pool, fixture);
    const migrationRoot = join(repo, 'netlify/database/migrations');
    assert.deepEqual((await readdir(migrationRoot)).filter(name => /^\d{14}_/.test(name)).sort(), migrations,
      'Migration set changed; reassess the baseline');
    for (const name of migrations) {
      abort.signal.throwIfAborted();
      const sql = await readFile(join(migrationRoot, name, 'migration.sql'), 'utf8');
      await pool.query(sql);
      result.migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    await pool.end(); pool = undefined;
    result.baseline = (await command('/usr/bin/git', ['rev-parse', 'HEAD'])).stdout.trim();
    result.sources = await Promise.all(['scripts/connected-candidate-api.mts', 'netlify/functions/_shared/connected-candidate.ts',
      'scripts/test-connected-candidate-database.mjs', 'scripts/test-connected-candidate-database.test.mjs',
      'scripts/connected-candidate-api.integration.test.ts'].map(async file =>
      ({ file, sha256: createHash('sha256').update(await readFile(join(repo, file))).digest('hex') })));
    const test = await command(process.execPath, ['--import', 'tsx', '--test', 'scripts/connected-candidate-api.integration.test.ts'],
      { timeout: 60000, env: { ...cleanEnvironment(), CC2C_FIXTURE_FILE: join(root, 'fixture.json'), CC2C_RUN_TOKEN: fixture.token } });
    result.testOutput = safeDiagnostic(test.stdout, fixture);
    console.log(result.testOutput);
    result.proof = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
    result.passed = true;
  } catch (error) {
    result.error = safeDiagnostic(error.message, fixture);
  } finally {
    try {
      if (pool) await pool.end();
      if (admin) await admin.end();
      await cleanup();
      result.cleanup = true;
    } catch (error) { result.cleanupError = safeDiagnostic(error.message, fixture); result.retainedFixture = root; }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(`CC2C1 evidence: ${join(evidence, 'result.json')}`);
  if (!result.passed || !result.cleanup) throw Error(`CC2C1 did not pass cleanly; inspect ${join(evidence, 'result.json')}`);
  console.log('CC2C1 passed; owned database stopped and removed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
