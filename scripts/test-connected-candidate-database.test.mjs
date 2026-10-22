import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { cleanEnvironment, cleanupOwnedFixture, connectionString, migrations, poolOptions,
  readOwnedFixture, safeDiagnostic, validateFixture, verifyDatabase, verifyFixtureFiles } from './test-connected-candidate-database.mjs';

const run = promisify(execFile);
const repo = new URL('../', import.meta.url);
const example = { version: 1, root: '/private/tmp/og-cc2c-ABC123', runId: '123456abcdef',
  database: 'cc2c_test_123456abcdef', user: 'cc2c_test_123456abcdef', password: 'p'.repeat(43), token: 't'.repeat(43) };

async function withFixture(body) {
  const root = await mkdtemp('/private/tmp/og-cc2c-');
  const fixture = { ...example, root, token: randomBytes(32).toString('base64url') };
  try {
    await writeFile(join(root, 'fixture.json'), JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
    await mkdir(join(root, 'data'), { mode: 0o700 });
    await mkdir(join(root, 'socket'), { mode: 0o700 });
    await body(fixture);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('fixture accepts only derived owned targets, never arbitrary connection settings', () => {
  assert.equal(validateFixture(example), example);
  assert.throws(() => validateFixture({}));
  for (const changed of [null, { root: '/tmp/og-cc2c-ABC123' }, { root: '/private/tmp/og-cc2c-ABC123/../other' },
    { root: '/Users/example/database' }, { database: 'production' }, { user: 'postgres' }, { runId: '../invalid' },
    { password: '' }, { token: '' }, { version: 2 }, { connectionString: 'postgresql://production/db' }]) {
    assert.throws(() => validateFixture(changed === null ? null : { ...example, ...changed }), undefined);
  }
  assert.throws(() => poolOptions(example, 'other_database'));
});

test('pool and candidate URL use only the derived socket, role and password', () => {
  const config = poolOptions(example);
  assert.equal(config.host, example.root + '/socket');
  assert.equal(config.database, example.database);
  const url = new URL(connectionString(example));
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.searchParams.get('host'), config.host);
  assert.equal(url.username, config.user);
  assert.equal(url.password, config.password);
  assert.equal(url.pathname, '/' + config.database);
});

test('child environment has no inherited account, dotenv, node or database overrides', () => {
  assert.deepEqual(Object.keys(cleanEnvironment()).sort(), ['LC_ALL', 'NODE_ENV', 'PATH', 'TMPDIR']);
  assert.equal(cleanEnvironment().NODE_ENV, 'test');
  assert.equal(cleanEnvironment().TMPDIR, '/private/tmp');
});

test('missing descriptor, arbitrary paths and wrong authorization fail before any connection', async () => {
  for (const file of [undefined, '', '/private/tmp/other.json', '/private/tmp/og-cc2c-ABC123/../fixture.json']) {
    await assert.rejects(readOwnedFixture(file, undefined));
  }
  await withFixture(async fixture => {
    const file = join(fixture.root, 'fixture.json');
    await assert.rejects(readOwnedFixture(file, 'wrong-token'));
    assert.equal((await readOwnedFixture(file, fixture.token)).database, fixture.database);
  });
});

test('permissive and redirected fixture paths are refused', async () => {
  await withFixture(async fixture => {
    const file = join(fixture.root, 'fixture.json');
    await chmod(file, 0o644);
    await assert.rejects(readOwnedFixture(file, fixture.token), /owner-only/);
    await chmod(file, 0o600);
    await rm(join(fixture.root, 'socket'), { recursive: true });
    await symlink(join(fixture.root, 'data'), join(fixture.root, 'socket'));
    await assert.rejects(verifyFixtureFiles(fixture), /ordinary owned path/);
  });
});

test('changed ownership record cannot authorize cleanup operations', async () => {
  await withFixture(async fixture => {
    await writeFile(join(fixture.root, 'fixture.json'), JSON.stringify({ ...fixture, token: 'x'.repeat(43) }));
    const calls = [];
    await assert.rejects(cleanupOwnedFixture(fixture, {
      isRunning: async () => { calls.push('status'); return false; },
      stop: async () => calls.push('stop'), remove: async () => calls.push('remove'),
    }), /record changed/);
    assert.deepEqual(calls, []);
  });
});

test('database identity and password checks precede all migration or fixture writes', async () => {
  await withFixture(async fixture => {
    const identity = { database: fixture.database, username: fixture.user, directory: join(fixture.root, 'data'),
      socket: join(fixture.root, 'socket'), listen: '', address: null };
    for (const wrong of [{ database: 'other' }, { username: 'other' }, { directory: '/private/tmp/other' },
      { listen: 'localhost' }, { socket: '/private/tmp/other' }, { address: '127.0.0.1' }]) {
      let calls = 0;
      await assert.rejects(verifyDatabase({ query: async sql => {
        assert.match(sql, /^SELECT /); calls++; return { rows: [{ ...identity, ...wrong }] };
      } }, fixture));
      assert.equal(calls, 1);
    }
    for (const auth of ['trust', 'peer', 'scram-sha-256']) {
      const pool = { query: async sql => ({ rows: sql.includes('pg_hba_file_rules')
        ? [{ type: 'local', auth_method: auth, error: null }] : [identity] }) };
      if (auth === 'scram-sha-256') assert.equal((await verifyDatabase(pool, fixture)).socketPasswordAuth, true);
      else await assert.rejects(verifyDatabase(pool, fixture), /password authentication/);
    }
  });
});

test('cleanup stops and confirms the owned cluster before removal', async () => {
  await withFixture(async fixture => {
    const calls = [];
    let running = true;
    await cleanupOwnedFixture(fixture, {
      isRunning: async () => { calls.push('status'); return running; },
      stop: async () => { calls.push('stop'); running = false; },
      remove: async () => { calls.push('remove'); },
    });
    assert.deepEqual(calls, ['status', 'stop', 'status', 'remove']);
  });
});

test('failed stop, unknown status or a still-running cluster preserve all files', async () => {
  await withFixture(async fixture => {
    for (const mode of ['stop-failure', 'unknown-status', 'still-running']) {
      let removed = false;
      await assert.rejects(cleanupOwnedFixture(fixture, {
        isRunning: async () => { if (mode === 'unknown-status') throw Error('status unavailable'); return true; },
        stop: async () => { if (mode === 'stop-failure') throw Error('stop failed'); },
        remove: async () => { removed = true; },
      }));
      assert.equal(removed, false);
      assert.ok(await readFile(join(fixture.root, 'fixture.json')));
    }
  });
});

test('a never-started fixture is cleaned without stopping unrelated processes', async () => {
  await withFixture(async fixture => {
    const calls = [];
    await cleanupOwnedFixture(fixture, { isRunning: async () => false,
      stop: async () => calls.push('stop'), remove: async () => calls.push('remove') });
    assert.deepEqual(calls, ['remove']);
  });
});

test('diagnostics redact generated credentials and database URLs', () => {
  const raw = `${example.password} ${example.token} ${connectionString(example)} Bearer abc.def.ghi pair_${'a'.repeat(43)} device_${'b'.repeat(43)}`;
  const safe = safeDiagnostic(raw, example);
  for (const value of [example.password, example.token, connectionString(example), 'abc.def.ghi', 'a'.repeat(43), 'b'.repeat(43)]) {
    assert.equal(safe.includes(value), false);
  }
});

test('migration contract is fixed to the twelve reviewed migrations', async () => {
  assert.equal(migrations.length, 12);
  assert.deepEqual(migrations, [...migrations].sort());
  for (const name of migrations) assert.ok((await readFile(new URL(`netlify/database/migrations/${name}/migration.sql`, repo))).length);
});

test('direct integration invocation refuses missing ownership facts despite inherited URLs', async () => {
  let failure;
  try {
    await run(process.execPath, ['--import', 'tsx', '--test', 'scripts/connected-candidate-api.integration.test.ts'],
      { cwd: repo, env: { ...cleanEnvironment(), AUTH_TEST_DATABASE_URL: 'postgresql://invalid.invalid/forbidden',
        SKILLGROUPS_DATABASE_URL: 'postgresql://invalid.invalid/forbidden', NETLIFY_DB_URL: 'postgresql://invalid.invalid/forbidden' }, timeout: 15000 });
  } catch (error) { failure = error; }
  assert.equal(failure?.code, 1);
  assert.match(failure.stdout + failure.stderr, /Run through the owned database runner/);
  assert.doesNotMatch(failure.stdout + failure.stderr, /ENOTFOUND|ECONNREFUSED|password authentication failed/);
});
