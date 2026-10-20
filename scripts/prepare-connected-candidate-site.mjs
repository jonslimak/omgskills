import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { candidateBuildOptions, candidateOrigin, hostingFiles } from './prepare-catalog-candidate-web.mjs';
import { fileInventory, mergedHeaders, prepareCandidateFunction, stagingConfig, validateFunctionPackage } from './prepare-catalog-candidate-hosting.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, body) => writeFile(path, body, { flag: 'wx', mode: 0o600 });

function fields(value, allowed, label) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, `${label} must be a plain object`);
  assert.ok(Reflect.ownKeys(value).every(key => allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')), `Unexpected ${label} field`);
}

async function canonicalDirectory(path, owned = false) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'Directory must be an explicit canonical path');
  const stat = await lstat(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'Directory must not be redirected');
  if (owned) assert.equal(stat.uid, process.getuid(), 'Output directory must be owned by the current user');
}

async function sources() {
  const paths = ['scripts/prepare-connected-candidate-site.mjs', 'scripts/prepare-catalog-candidate-hosting.mjs',
    'scripts/prepare-catalog-candidate-web.mjs', 'scripts/catalog-candidate-record.mts', 'scripts/connected-candidate-api.mts',
    'portal/index.html', 'package.json', 'package-lock.json'];
  async function collect(directory) {
    for (const entry of await readdir(join(repo, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), 'Source directories must not contain links');
      if (entry.isDirectory()) await collect(path);
      else if (/\.(?:[cm]?ts|tsx|css|json)$/.test(path)) paths.push(path);
    }
  }
  for (const directory of ['portal/src', 'netlify/functions', 'mcp/src']) await collect(directory);
  return Promise.all(paths.sort().map(async path => ({ path, sha256: hash(await readFile(join(repo, path))) })));
}

export async function prepareConnectedCandidateSite(options) {
  fields(options, ['root', 'retainedSite', 'configuration'], 'preparation options');
  const { root, retainedSite, configuration } = options;
  fields(configuration, ['profile', 'publishableKey', 'clerkFrontendOrigin'], 'public configuration');
  assert.equal(configuration.profile, 'connected', 'Explicit connected profile required');
  const files = hostingFiles(configuration);
  await canonicalDirectory(root, true);
  const outputPath = relative(repo, root);
  // The installed bundler traces external dependencies from the generated function's location.
  assert.ok(outputPath && outputPath !== '..' && !outputPath.startsWith('../') && !isAbsolute(outputPath),
    'Output must be inside the implementation checkout so function dependencies can be traced');
  await canonicalDirectory(retainedSite);
  assert.ok(root !== retainedSite && !root.startsWith(retainedSite + '/') && !retainedSite.startsWith(root + '/'),
    'Source and output must be distinct and non-nested');
  assert.deepEqual(await readdir(root), [], 'Output must be empty; previous/failed packages are preserved');
  const retained = await fileInventory(retainedSite);
  assert.ok(retained.some(file => file.path === '_headers'), 'Retained headers are required');
  const headers = mergedHeaders(await readFile(join(retainedSite, '_headers'), 'utf8'), retained, configuration);
  for (const name of ['_redirects', 'robots.txt', '404.html']) {
    if (!retained.some(file => file.path === name)) continue;
    const text = await readFile(join(retainedSite, name), 'utf8');
    const accepted = name === '_redirects' ? [hostingFiles()._redirects, files[name]] : [files[name]];
    assert.ok(accepted.includes(text), `Unsupported retained ${name}`);
  }
  const cliRequire = createRequire(require.resolve('netlify-cli/package.json'));
  const bundleEntry = cliRequire.resolve('@netlify/zip-it-and-ship-it');
  const { zipFunctions } = await import(pathToFileURL(bundleEntry));
  const bundlerVersion = JSON.parse(await readFile(join(dirname(bundleEntry), '../package.json'), 'utf8')).version;
  const before = await sources();
  // All validation above is read-only. Failed builds below intentionally remain for inspection.
  const overlay = join(root, 'overlay'), site = join(root, 'site');
  await mkdir(overlay);
  const result = await build(candidateBuildOptions(overlay, configuration));
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
  const modules = [...new Set(outputs.filter(item => item.type === 'chunk').flatMap(item => Object.keys(item.modules)))];
  assert.ok(modules.some(id => id.endsWith('/src/candidate/connected-main.tsx')), 'Missing connected entry');
  assert.ok(!modules.some(id => /\/src\/(?:bootstrap\.ts$|preview\/|candidate\/(?:main\.tsx|distribution\.(?:ts|json))$)/.test(id)),
    'Unexpected active browser entry or distribution');
  const active = await fileInventory(overlay);
  for (const file of active) {
    assert.ok(file.path === 'app/index.html' || file.path.startsWith('app/assets/'), 'Unexpected web overlay path');
    const bytes = await readFile(join(overlay, file.path), 'utf8');
    assert.doesNotMatch(bytes, /OMGSkills-Catalog-Candidate-0\.0\.(?:21|0)-|sk_(?:test|live)_[A-Za-z0-9]+|postgresql:\/\//,
      'Active web graph contains an unavailable download or private configuration');
    const existing = retained.find(old => old.path === file.path);
    if (existing && file.path !== 'app/index.html') assert.equal(file.sha256, existing.sha256, `Overlay collision: ${file.path}`);
  }
  const html = await readFile(join(overlay, 'app/index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'Connected entry must reference built assets');
  for (const route of ['/app/', '/app/connect']) for (const asset of assets) {
    const url = new URL(asset, candidateOrigin + route);
    assert.ok(url.origin === candidateOrigin && url.pathname.startsWith('/app/assets/')
      && active.some(file => file.path === url.pathname.slice(1)), 'Connected entry asset must exist on the same origin');
  }
  await mkdir(site);
  async function copy(source, file) {
    const destination = join(site, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(source, file.path), destination, constants.COPYFILE_EXCL);
  }
  for (const file of retained) if (!['app/index.html', '_headers', '_redirects'].includes(file.path)) await copy(retainedSite, file);
  for (const file of active) if (!retained.some(old => old.path === file.path) || file.path === 'app/index.html') await copy(overlay, file);
  for (const [name, body] of Object.entries({ ...files, _headers: headers })) {
    if (!['robots.txt', '404.html'].includes(name) || !retained.some(file => file.path === name)) await save(join(site, name), body);
  }
  for (const directory of ['functions', 'edge-functions']) await mkdir(join(root, directory));
  await prepareCandidateFunction(root, { profile: 'connected' });
  const names = ['catalog-candidate-record', 'connected-candidate-api'];
  assert.deepEqual((await fileInventory(join(root, 'functions'))).map(file => file.path), names.map(name => `${name}.mjs`));
  await zipFunctions(join(root, 'functions'), join(root, 'function-check'), {
    archiveFormat: 'zip', basePath: repo, repositoryRoot: repo, configFileDirectories: [],
    manifest: join(root, 'function-check/manifest.json'), parallelLimit: 1,
    config: Object.fromEntries(names.map(name => [name, { nodeBundler: 'nft', nodeVersion: '20.x' }])),
  });
  const manifest = JSON.parse(await readFile(join(root, 'function-check/manifest.json'), 'utf8'));
  validateFunctionPackage(manifest, root, { profile: 'connected' });
  const packages = await fileInventory(join(root, 'function-check'));
  assert.deepEqual(packages.map(file => file.path), [...names.map(name => `${name}.zip`), 'manifest.json'].sort());
  await save(join(root, 'netlify.toml'), stagingConfig());
  const merged = await fileInventory(site);
  for (const old of retained.filter(file => !['app/index.html', '_headers', '_redirects'].includes(file.path))) {
    assert.deepEqual(merged.find(file => file.path === old.path), old, `Retained bytes changed: ${old.path}`);
  }
  assert.deepEqual(await fileInventory(retainedSite), retained, 'Retained source changed during preparation');
  assert.deepEqual(await sources(), before, 'Code changed during preparation');
  const receipt = { stage: 'offline-connected-candidate-prepared', profile: 'connected', origin: candidateOrigin,
    configurationLabel: 'synthetic-development-configuration; not account-verified',
    deployable: false, hosted: false, published: false, download: null, updateFeed: null,
    boundary: 'Offline composition only; no real account, CDN, signed download or installation proof',
    sources: before, retained, merged, active, functions: await fileInventory(join(root, 'functions')), packages,
    configSHA256: hash(await readFile(join(root, 'netlify.toml'))), bundlerVersion };
  await save(join(root, 'preparation.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
