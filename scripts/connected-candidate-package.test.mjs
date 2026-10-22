import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const file = fileURLToPath(import.meta.url);
const repo = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('netlify-cli/package.json'));
const sentinel = 'CC2C2_UNAPPROVED_ENVIRONMENT_SENTINEL';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnvironment = () => ({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C',
  TMPDIR: '/private/tmp', NODE_ENV: 'test', CLERK_SECRET_KEY: `sk_test_${sentinel}`,
  SKILLGROUPS_DATABASE_URL: `postgresql://${sentinel}@invalid.invalid/forbidden`, NETLIFY_AUTH_TOKEN: sentinel });

async function findPackageManifest(name, entry) {
  const parts = name.split('/');
  const packageName = parts.slice(0, name.startsWith('@') ? 2 : 1).join('/');
  for (const directory of createRequire(entry).resolve.paths(name) ?? []) {
    try { return await realpath(join(directory, packageName, 'package.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw Error('Packaged dependency manifest is missing: ' + packageName);
}

function validateEntry(entry, names) {
  assert.ok(entry.fileName && !isAbsolute(entry.fileName) && !entry.fileName.includes('\\')
    && !/^[a-z]:/i.test(entry.fileName) && !entry.fileName.split('/').some(part => part === '..' || part === '.'), 'Unsafe archive path');
  assert.equal(names.has(entry.fileName), false, 'Duplicate archive path');
  const type = (entry.externalFileAttributes >>> 16) & 0o170000;
  assert.ok([0, 0o100000, 0o040000].includes(type), 'Archive links and special files are forbidden');
  assert.ok(entry.uncompressedSize >= 0 && entry.uncompressedSize <= 16 * 1024 * 1024, 'Archive entry is too large');
  assert.ok(names.size < 6000, 'Archive has too many entries');
  names.add(entry.fileName);
}

async function extractArchive(archive, destination) {
  const yauzl = cliRequire('yauzl');
  const inventory = [];
  const names = new Set();
  let size = 0;
  await new Promise((fulfill, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error) return reject(error);
      const fail = reason => { zip.close(); reject(reason); };
      zip.on('error', fail);
      zip.on('end', fulfill);
      zip.on('entry', entry => {
        (async () => {
          validateEntry(entry, names);
          size += entry.uncompressedSize;
          assert.ok(size <= 128 * 1024 * 1024, 'Archive exceeds the test limit');
          assert.doesNotMatch(entry.fileName, /(?:^|\/)(?:tests?|__tests__|\.env(?:\.[^/]*)?|clerk\.env|fixture\.json|proof\.json)(?:\/|$)|\.(?:test\.[cm]?[jt]s|p12|p8|dmg|app)(?:\/|$)/,
            'Private/test/native input leaked into archive');
          const output = resolve(destination, entry.fileName);
          assert.ok(relative(destination, output) && !relative(destination, output).startsWith('..'), 'Extraction must stay inside the owned root');
          if (entry.fileName.endsWith('/')) {
            await mkdir(output, { recursive: true, mode: 0o700 });
          } else {
            const stream = await new Promise((accept, refuse) => zip.openReadStream(entry, (reason, value) => reason ? refuse(reason) : accept(value)));
            const chunks = [];
            let length = 0;
            for await (const chunk of stream) {
              length += chunk.length;
              assert.ok(length <= entry.uncompressedSize, 'Archive size mismatch');
              chunks.push(chunk);
            }
            const bytes = Buffer.concat(chunks);
            assert.equal(bytes.length, entry.uncompressedSize);
            assert.equal(bytes.includes(Buffer.from(sentinel)), false, 'Environment value leaked into package');
            await mkdir(dirname(output), { recursive: true, mode: 0o700 });
            await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
            inventory.push({ path: entry.fileName, bytes: bytes.length, sha256: hash(bytes) });
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}

async function smokeWorker() {
  const root = await realpath(process.env.CC2C2_EXTRACT);
  assert.equal(dirname(root), '/private/tmp');
  assert.match(root, /\/og-cc2c2-extract-[A-Za-z0-9]{6}$/);
  const user = resolve(root, process.env.CC2C2_USER_ENTRY);
  const adapter = resolve(root, process.env.CC2C2_ADAPTER_ENTRY);
  for (const entry of [user, adapter]) assert.ok(entry.startsWith(root + '/') && await realpath(entry) === entry);
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw Error('External fetch forbidden'); };
  net.Socket.prototype.connect = function () { networkCalls++; throw Error('Network and database connections forbidden'); };
  // Only emulate AWS's handler registration; the user handler and bootstrap are real ZIP bytes.
  globalThis.awslambda = { streamifyResponse: handler => handler };
  const runtime = await import(pathToFileURL(adapter));
  assert.equal(typeof runtime.handler, 'function');
  const module = await import(pathToFileURL(user));
  assert.equal(typeof module.default, 'function');
  const dependencies = {};
  for (const name of ['pg', '@clerk/backend', '@netlify/database', 'drizzle-orm/node-postgres']) {
    // The real ESM module already loaded above. CJS resolution can select an untraced alternate export.
    const dependency = await findPackageManifest(name, user);
    assert.ok(dependency.startsWith(root + '/'), 'Runtime dependency escaped the extracted package');
    dependencies[name] = relative(root, dependency);
  }
  assert.deepEqual(module.config.method, ['GET', 'POST', 'OPTIONS']);
  assert.deepEqual(module.config.rateLimit, { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowLimit: 30, windowSize: 60 });
  const origin = 'https://omgskills-setup-test-f3b.netlify.app';
  const req = new Request(origin + '/api/portal/synced-skills?version=3');
  const wrong = await module.default(req, { site: { id: 'not-the-test-site' }, deploy: { context: 'production' } });
  assert.equal(wrong.status, 404);
  const unavailable = await module.default(req, { site: { id: '16f435c1-e5d0-4b40-b174-382d839e877b' }, deploy: { context: 'production' } });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ adapterLoaded: true, userHandlerLoaded: true, dependencies, paths: module.config.path,
    wrongSite: wrong.status, missingConfiguration: unavailable.status, networkCalls,
    limit: 'AWS adapter registration/load only; refusal calls use the real packaged user handler with a fake context' }));
}

async function packageWorker() {
  let staging;
  const extracted = [];
  const evidence = await mkdtemp('/private/tmp/og-cc2c2-evidence-');
  const receipt = { checkpoint: 'CC2C2', passed: false, cleanup: false, profiles: [], sources: [],
    commands: [[process.execPath, '--test', file]], isolation: 'minimal child environment; no real auth/database; network blocked' };
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw Error('Offline package test attempted fetch'); };
  net.Socket.prototype.connect = function () { networkCalls++; throw Error('Offline package test attempted a connection'); };
  try {
    const bundleEntry = cliRequire.resolve('@netlify/zip-it-and-ship-it');
    const { zipFunctions } = await import(pathToFileURL(bundleEntry));
    receipt.bundlerVersion = JSON.parse(await readFile(join(dirname(bundleEntry), '../package.json'), 'utf8')).version;
    receipt.nodeVersion = process.version;
    receipt.baseline = (await execute('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: repo, env: cleanEnvironment(), timeout: 5000 })).stdout.trim();
    const { prepareCandidateFunction, validateFunctionPackage, fileInventory } = await import('./prepare-catalog-candidate-hosting.mjs');
    staging = await realpath(await mkdtemp(join(repo, '.cc2c2-package-')));
    for (const profile of ['install-only', 'connected']) {
      const root = join(staging, profile);
      await mkdir(join(root, 'functions'), { recursive: true, mode: 0o700 });
      const options = { profile };
      await prepareCandidateFunction(root, options);
      const names = profile === 'connected' ? ['catalog-candidate-record', 'connected-candidate-api'] : ['catalog-candidate-record'];
      assert.deepEqual((await fileInventory(join(root, 'functions'))).map(item => item.path), names.map(name => `${name}.mjs`));
      const config = Object.fromEntries(names.map(name => [name, { nodeBundler: 'nft', nodeVersion: '20.x' }]));
      const functions = await zipFunctions(join(root, 'functions'), join(root, 'function-check'), {
        archiveFormat: 'zip', basePath: repo, repositoryRoot: repo, configFileDirectories: [],
        manifest: join(root, 'function-check/manifest.json'), config, parallelLimit: 1,
      });
      const manifest = JSON.parse(await readFile(join(root, 'function-check/manifest.json'), 'utf8'));
      validateFunctionPackage(manifest, root, options);
      assert.deepEqual((await fileInventory(join(root, 'function-check'))).map(item => item.path),
        [...names.map(name => `${name}.zip`), 'manifest.json'].sort());
      const record = { profile, manifest, zipFiles: await fileInventory(join(root, 'function-check')), archives: [] };
      for (const fn of functions) {
        const destination = await realpath(await mkdtemp('/private/tmp/og-cc2c2-extract-'));
        extracted.push(destination);
        const inventory = await extractArchive(fn.path, destination);
        assert.ok(inventory.length > 0);
        const archive = { name: fn.name, sha256: hash(await readFile(fn.path)), files: inventory };
        if (fn.name === 'connected-candidate-api') {
          assert.equal(fn.runtimeAPIVersion, 2, 'The actual package must retain the modern runtime adapter');
          const entries = inventory.filter(entry => entry.path.endsWith('/connected-candidate-api.mjs') || entry.path === 'connected-candidate-api.mjs');
          assert.equal(entries.length, 1, 'Exactly one real candidate user entry is required');
          assert.ok(inventory.some(entry => entry.path === fn.entryFilename), 'Actual adapter entry is missing');
          const args = [file];
          receipt.commands.push([process.execPath, ...args]);
          const child = await execute(process.execPath, args, { cwd: destination, env: { ...cleanEnvironment(),
            CC2C2_MODE: 'smoke', CC2C2_EXTRACT: destination, CC2C2_USER_ENTRY: entries[0].path,
            CC2C2_ADAPTER_ENTRY: fn.entryFilename }, timeout: 15000, maxBuffer: 1024 * 1024 });
          archive.smoke = JSON.parse(child.stdout);
          assert.deepEqual(archive.smoke.paths.slice().sort(), manifest.functions.find(item => item.name === fn.name).routes.map(route => route.pattern).sort());
        }
        record.archives.push(archive);
      }
      receipt.profiles.push(record);
    }
    for (const source of ['scripts/prepare-catalog-candidate-hosting.mjs', 'scripts/prepare-catalog-candidate-hosting.test.mjs',
      'scripts/connected-candidate-api.mts', 'scripts/connected-candidate-package.test.mjs']) {
      receipt.sources.push({ source, sha256: hash(await readFile(join(repo, source))) });
    }
    assert.equal(networkCalls, 0);
    receipt.networkCalls = networkCalls;
    receipt.passed = true;
  } catch (error) {
    receipt.error = [error.stack, error.stdout, error.stderr].filter(Boolean).join('\n').replaceAll(sentinel, '[synthetic sentinel]').slice(-16000);
  } finally {
    try {
      for (const directory of extracted) await rm(directory, { recursive: true });
      if (staging) await rm(staging, { recursive: true });
      receipt.cleanup = true;
    } catch (error) { receipt.cleanupError = error.message; receipt.retained = { staging, extracted }; }
    await writeFile(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ passed: receipt.passed, cleanup: receipt.cleanup, evidence: join(evidence, 'result.json'), error: receipt.error }));
  if (!receipt.passed || !receipt.cleanup) process.exitCode = 1;
}

if (process.env.CC2C2_MODE === 'package') {
  await packageWorker();
} else if (process.env.CC2C2_MODE === 'smoke') {
  await smokeWorker();
} else {
  test('archive validation rejects traversal, redirects, duplicates and oversized entries', () => {
    const entry = { fileName: 'function.mjs', externalFileAttributes: 0o100600 << 16, uncompressedSize: 10 };
    for (const fileName of ['/outside', '../outside', 'a/../../outside', 'a\\outside', 'C:/outside', './outside']) {
      assert.throws(() => validateEntry({ ...entry, fileName }, new Set()));
    }
    assert.throws(() => validateEntry({ ...entry, externalFileAttributes: 0o120777 << 16 }, new Set()));
    assert.throws(() => validateEntry({ ...entry, uncompressedSize: 17 * 1024 * 1024 }, new Set()));
    const names = new Set();
    validateEntry(entry, names);
    assert.throws(() => validateEntry(entry, names));
  });
  test('real install-only and connected packages have exact routes and a self-contained runtime', { timeout: 120000 }, async t => {
    let summary;
    try {
      const output = await execute(process.execPath, [file], { cwd: repo,
        env: { ...cleanEnvironment(), CC2C2_MODE: 'package' }, timeout: 100000, maxBuffer: 4 * 1024 * 1024 });
      summary = JSON.parse(output.stdout);
    } catch (error) {
      if (error.stdout) summary = JSON.parse(error.stdout);
      else throw error;
    }
    t.diagnostic(`CC2C2 evidence: ${summary.evidence}`);
    assert.equal(summary.cleanup, true, 'Owned package files must be removed');
    assert.equal(summary.passed, true, summary.error);
  });
}
