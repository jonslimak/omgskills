import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareConnectedCandidateSite } from './prepare-connected-candidate-site.mjs';
import { fileInventory, stagingConfig, validateFunctionPackage } from './prepare-catalog-candidate-hosting.mjs';
import { candidateOrigin, hostingFiles } from './prepare-catalog-candidate-web.mjs';

const execute = promisify(execFile);
const file = fileURLToPath(import.meta.url), repo = fileURLToPath(new URL('../', import.meta.url));
const sentinel = 'CC4A_PRIVATE_ENVIRONMENT_SENTINEL';
const configuration = { profile: 'connected',
  publishableKey: `pk_test_${Buffer.from('cc4a-fixture.clerk.accounts.dev$').toString('base64')}`,
  clerkFrontendOrigin: 'https://cc4a-fixture.clerk.accounts.dev' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnvironment = () => ({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C',
  TMPDIR: '/private/tmp', NODE_ENV: 'test', CLERK_SECRET_KEY: `sk_test_${sentinel}`,
  SKILLGROUPS_DATABASE_URL: `postgresql://${sentinel}@invalid.invalid/forbidden`, NETLIFY_AUTH_TOKEN: sentinel,
  VITE_PRIVATE_SENTINEL: sentinel });

async function put(root, path, bytes) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
async function fixture() {
  // Stay under the repository so the installed bundler can trace its declared external dependencies.
  const parent = await realpath(await mkdtemp(join(repo, '.cc4a-site-')));
  const root = join(parent, 'output'), retainedSite = join(parent, 'retained');
  await mkdir(root); await mkdir(retainedSite);
  const files = { ...hostingFiles(), 'app/index.html': '<title>Old install-only fixture</title>\n',
    'app/preview/unified/index.html': '<a href="/updates/history/old-0.0.21.zip">Inert historical download</a>\n',
    'app/assets/retained.js': '/* retained old asset */\n', 'test.css': 'body { color: black; }\n',
    'updates/history/old-0.0.21.zip': 'Opaque synthetic archive fixture, not an app',
    'updates/history/appcast.xml': '<rss>Inert test feed</rss>\n' };
  for (const [path, bytes] of Object.entries(files)) await put(retainedSite, path, bytes);
  return { parent, root, retainedSite, configuration };
}
async function cleanup(path) {
  try { await rm(path, { recursive: true }); }
  catch (error) { throw new Error(`Owned fixture cleanup failed; retained at ${path}`, { cause: error }); }
}

async function zipInventory(path) {
  const require = createRequire(import.meta.url);
  const cliRequire = createRequire(require.resolve('netlify-cli/package.json'));
  const yauzl = cliRequire('yauzl');
  const files = [];
  await new Promise((accept, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail); zip.on('end', accept);
      zip.on('entry', entry => {
        (async () => {
          assert.doesNotMatch(entry.fileName, /(?:^|\/)(?:\.env(?:\.[^/]*)?|tests?|clerk\.env)(?:\/|$)|\.test\.[cm]?[jt]s$|\.(?:p12|p8|app)(?:\/|$)/);
          if (!entry.fileName.endsWith('/')) {
            const stream = await new Promise((accept, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : accept(stream)));
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            assert.equal(bytes.includes(Buffer.from(sentinel)), false);
            files.push({ path: entry.fileName, bytes: bytes.length, sha256: hash(bytes) });
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
  assert.ok(files.length > 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function worker() {
  let fixtureData;
  const evidence = await mkdtemp('/private/tmp/og-cc4a-evidence-');
  const proof = { checkpoint: 'CC4A', passed: false, cleanup: false, nodeVersion: process.version };
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw Error('CC4A fetch forbidden'); };
  net.Socket.prototype.connect = function () { networkCalls++; throw Error('CC4A network/database forbidden'); };
  try {
    fixtureData = await fixture();
    const { parent, ...options } = fixtureData;
    const before = await fileInventory(options.retainedSite);
    const receipt = await prepareConnectedCandidateSite(options);
    assert.deepEqual(receipt, JSON.parse(await readFile(join(options.root, 'preparation.json'), 'utf8')));
    assert.equal(receipt.stage, 'offline-connected-candidate-prepared');
    for (const flag of ['deployable', 'hosted', 'published']) assert.equal(receipt[flag], false);
    assert.equal(receipt.download, null); assert.equal(receipt.updateFeed, null);
    assert.match(receipt.configurationLabel, /synthetic/);
    assert.equal(receipt.origin, candidateOrigin); assert.equal(receipt.profile, 'connected');
    assert.deepEqual(receipt.retained, before);
    assert.deepEqual(await fileInventory(options.retainedSite), before);
    assert.deepEqual(receipt.merged, await fileInventory(join(options.root, 'site')));
    assert.deepEqual(receipt.packages, await fileInventory(join(options.root, 'function-check')));
    assert.deepEqual(receipt.functions.map(item => item.path), ['catalog-candidate-record.mjs', 'connected-candidate-api.mjs']);
    assert.equal(await readFile(join(options.root, 'netlify.toml'), 'utf8'), stagingConfig());
    assert.deepEqual(await readdir(join(options.root, 'edge-functions')), []);
    assert.ok(!receipt.merged.some(item => item.path === 'preparation.json'));
    for (const source of receipt.sources) assert.equal(source.sha256, hash(await readFile(join(repo, source.path))));
    assert.ok(receipt.sources.some(item => item.path === 'portal/src/candidate/connected-main.tsx'));
    const site = join(options.root, 'site');
    const html = await readFile(join(site, 'app/index.html'), 'utf8');
    assert.match(html, /<title>OMGSkills Connected Candidate<\/title>/);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    for (const route of ['/app/', '/app/connect']) for (const asset of assets) {
      const url = new URL(asset, candidateOrigin + route);
      assert.equal(url.origin, candidateOrigin);
      assert.ok(url.pathname.startsWith('/app/assets/'));
      await readFile(join(site, url.pathname.slice(1)));
    }
    let activeText = '';
    for (const asset of receipt.active) activeText += await readFile(join(site, asset.path), 'utf8');
    assert.ok(activeText.includes(configuration.publishableKey));
    assert.ok(activeText.includes(configuration.clerkFrontendOrigin));
    assert.doesNotMatch(activeText, /OMGSkills-Catalog-Candidate-0\.0\.(?:21|0)-|CC4A_PRIVATE_ENVIRONMENT_SENTINEL|postgresql:\/\//);
    for (const artifact of ['site', 'functions']) for (const item of await fileInventory(join(options.root, artifact))) {
      assert.equal((await readFile(join(options.root, artifact, item.path))).includes(Buffer.from(sentinel)), false);
    }
    const policy = hostingFiles(configuration);
    assert.equal(await readFile(join(site, '_redirects'), 'utf8'), policy._redirects);
    assert.doesNotMatch(policy._redirects, /api\/portal|install-record|\/app\/\*/);
    assert.match(await readFile(join(site, '_headers'), 'utf8'), /\/app\/connect\n  Content-Security-Policy:/);
    const manifest = JSON.parse(await readFile(join(options.root, 'function-check/manifest.json'), 'utf8'));
    validateFunctionPackage(manifest, options.root, { profile: 'connected' });
    assert.equal(manifest.functions.find(fn => fn.name === 'connected-candidate-api').routes.length, 10);
    const archives = [];
    for (const fn of manifest.functions) {
      archives.push({ name: fn.name, files: await zipInventory(fn.path) });
    }
    const api = archives.find(archive => archive.name === 'connected-candidate-api');
    for (const dependency of ['pg', '@clerk/backend', '@netlify/database', 'drizzle-orm']) {
      assert.ok(api.files.some(entry => entry.path.includes(`node_modules/${dependency}/`)),
        `Connected API archive is missing ${dependency}`);
    }
    const snapshot = await fileInventory(options.root);
    await assert.rejects(prepareConnectedCandidateSite(options), /Output must be empty/);
    assert.deepEqual(await fileInventory(options.root), snapshot, 'Reuse must preserve output');
    // Exercise a real generated asset collision without replacing any retained bytes.
    const asset = receipt.active.find(item => item.path.endsWith('.js'));
    assert.ok(asset);
    await put(options.retainedSite, asset.path, 'conflicting retained asset');
    const collisionBefore = await fileInventory(options.retainedSite);
    const collisionRoot = join(parent, 'collision'); await mkdir(collisionRoot);
    await assert.rejects(prepareConnectedCandidateSite({ ...options, root: collisionRoot }), /Overlay collision/);
    assert.deepEqual(await fileInventory(options.retainedSite), collisionBefore);
    assert.ok((await fileInventory(collisionRoot)).length > 0, 'Failed overlay is preserved until test cleanup');
    assert.equal(networkCalls, 0);
    Object.assign(proof, { passed: true, receipt, archives, networkCalls, collisionRefused: true, reuseRefused: true });
  } catch (error) { proof.error = [error.stack, error.stdout, error.stderr].filter(Boolean).join('\n').replaceAll(sentinel, '[synthetic sentinel]').slice(-12000); }
  finally {
    try { if (fixtureData) await cleanup(fixtureData.parent); proof.cleanup = true; }
    catch (error) { proof.cleanupError = error.message; proof.retained = fixtureData?.parent; }
    await writeFile(join(evidence, 'result.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ passed: proof.passed, cleanup: proof.cleanup, evidence: join(evidence, 'result.json'), error: proof.error }));
  if (!proof.passed || !proof.cleanup) process.exitCode = 1;
}

if (process.env.CC4A_MODE === 'package') {
  await worker();
} else {
  test('import has no writes, connections or automatic preparation', async () => {
    const cwd = await realpath(await mkdtemp('/private/tmp/og-cc4a-import-'));
    try {
      const source = `import net from 'node:net'; globalThis.fetch = () => { throw Error('fetch forbidden'); };
        net.Socket.prototype.connect = () => { throw Error('connection forbidden'); };
        await import(${JSON.stringify(new URL('./prepare-connected-candidate-site.mjs', import.meta.url).href)});`;
      await execute(process.execPath, ['--input-type=module', '-e', source], { cwd, env: cleanEnvironment(), timeout: 15000 });
      assert.deepEqual(await readdir(cwd), []);
    } finally { await cleanup(cwd); }
  });
  test('invalid options, paths and retained policy fail before any output writes', async () => {
    const data = await fixture(), { parent, ...options } = data;
    try {
      const before = await fileInventory(options.retainedSite);
      for (const value of [undefined, null, [], { ...options, extra: true }, { ...options, configuration: {} },
        { ...options, configuration: { ...configuration, profile: 'install-only' } },
        { ...options, configuration: { ...configuration, secret: 'not-allowed' } },
        { ...options, configuration: { ...configuration, clerkFrontendOrigin: 'https://evil.test' } },
        { ...options, root: 'relative' }, { ...options, root: options.root + '/' },
        { ...options, root: join(parent, 'missing') }, { ...options, retainedSite: options.root },
        { ...options, retainedSite: parent }, { ...options, root: parent }]) {
        await assert.rejects(prepareConnectedCandidateSite(value));
        assert.deepEqual(await readdir(options.root), []);
        assert.deepEqual(await fileInventory(options.retainedSite), before);
      }
      for (const name of ['root', 'retainedSite']) {
        const link = join(parent, `link-${name}`); await symlink(options[name], link);
        await assert.rejects(prepareConnectedCandidateSite({ ...options, [name]: link }));
        assert.deepEqual(await readdir(options.root), []);
      }
      await put(options.root, 'existing', 'preserve');
      await assert.rejects(prepareConnectedCandidateSite(options), /Output must be empty/);
      assert.equal(await readFile(join(options.root, 'existing'), 'utf8'), 'preserve');
      await rm(join(options.root, 'existing'));
      const forbidden = { '_headers': hostingFiles()._headers + '/app/*\n  Cache-Control: public\n',
        '_redirects': '/api/portal/* https://omgskills.com/:splat 200\n', 'robots.txt': 'Allow: /\n', '404.html': 'unexpected collision' };
      for (const [path, bytes] of Object.entries(forbidden)) {
        const old = await readFile(join(options.retainedSite, path));
        await put(options.retainedSite, path, bytes);
        const invalid = await fileInventory(options.retainedSite);
        await assert.rejects(prepareConnectedCandidateSite(options));
        assert.deepEqual(await readdir(options.root), []);
        assert.deepEqual(await fileInventory(options.retainedSite), invalid);
        await put(options.retainedSite, path, old);
      }
      await symlink('app/index.html', join(options.retainedSite, 'redirected'));
      await assert.rejects(prepareConnectedCandidateSite(options), /ordinary files/);
      assert.deepEqual(await readdir(options.root), []);
      await rm(join(options.retainedSite, 'redirected'));
      await rm(join(options.retainedSite, '_headers'));
      await assert.rejects(prepareConnectedCandidateSite(options), /headers are required/);
      assert.deepEqual(await readdir(options.root), []);
    } finally { await cleanup(parent); }
  });
  test('output outside the checkout is refused before writes or a success receipt', async () => {
    const data = await fixture(), { parent, ...options } = data;
    const outside = await realpath(await mkdtemp('/private/tmp/og-cc4a-outside-'));
    try {
      const retained = await fileInventory(options.retainedSite);
      await assert.rejects(prepareConnectedCandidateSite({ ...options, root: outside }),
        /Output must be inside the implementation checkout/);
      assert.deepEqual(await readdir(outside), [], 'Refusal must not create an overlay, package or receipt');
      assert.deepEqual(await readdir(options.root), []);
      assert.deepEqual(await fileInventory(options.retainedSite), retained);
    } finally { await cleanup(outside); await cleanup(parent); }
  });
  test('real offline connected site combines retained bytes, web assets and both function ZIPs', { timeout: 120000 }, async t => {
    let summary;
    try {
      const result = await execute(process.execPath, [file], { cwd: repo, env: { ...cleanEnvironment(), CC4A_MODE: 'package' },
        timeout: 110000, maxBuffer: 4 * 1024 * 1024 });
      summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
    } catch (error) {
      if (!error.stdout) throw error;
      summary = JSON.parse(error.stdout.trim().split('\n').at(-1));
    }
    t.diagnostic(`CC4A evidence: ${summary.evidence}`);
    assert.equal(summary.cleanup, true, 'Owned fixture must be cleaned');
    assert.equal(summary.passed, true, summary.error);
  });
}
