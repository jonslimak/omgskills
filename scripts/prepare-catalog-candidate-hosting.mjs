#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { prepareCandidateWeb, hostingFiles, candidateOrigin } from './prepare-catalog-candidate-web.mjs';
import { archiveName, releases } from './release-catalog-candidate.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const siteId = '16f435c1-e5d0-4b40-b174-382d839e877b';
export const baselineDeploy = '6acd33ef8c1e4ad587f700ed';
const baselinePath = join(repo, 'menubar/.build/setup-test-upgrades/f3d-r4NPBX/hosting-preparation.json');
const releaseRoot = join(repo, 'menubar/.build/catalog-candidate-releases/candidate-0JiBfp');
const parent = join(repo, 'menubar/.build/catalog-candidate-hosting');
const cli = join(repo, 'node_modules/.bin/netlify');
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const sourceFiles = ['scripts/prepare-catalog-candidate-hosting.mjs', 'scripts/prepare-catalog-candidate-hosting.test.mjs',
  'scripts/prepare-catalog-candidate-web.mjs', 'scripts/prepare-catalog-candidate-web.test.mjs',
  'portal/src/candidate/main.tsx', 'portal/src/candidate/policy.ts', 'portal/src/candidate/distribution.ts',
  'portal/src/candidate/distribution.json', 'portal/src/app/unified/CatalogInstallSetup.tsx', 'portal/tests/catalog-candidate.test.ts',
  'scripts/catalog-candidate-record.mts', 'netlify/functions/_shared/catalog-install-record.ts',
  'netlify/functions/_shared/mcp-library.ts', 'mcp/src/library.ts', 'mcp/src/paging.ts',
  'mcp/src/search-ranking.ts', 'mcp/src/search-ranking-policy.mjs', 'mcp/src/install-record.mjs',
  'mcp/src/catalog-tracks.ts', 'mcp/src/search-catalog.ts', 'mcp/src/search-catalog-format.mjs'];
const candidateAccountPaths = [
  '/api/portal/sync-pairing-code', '/api/portal/sync-exchange', '/api/portal/sync-upload',
  '/api/portal/synced-skills', '/api/portal/device-revoke', '/api/portal/devices',
  '/api/portal/profile', '/api/portal/groups', '/api/portal/shared', '/api/portal/groups/:groupId',
];
const groupRouteExpression = '^\\/api\\/portal\\/groups(?:\\/([^\\/]+?))\\/?$';
function connectedFunctions(options) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options), 'Function options must be an object');
  assert.ok(Object.keys(options).every(key => key === 'profile'), 'Unexpected function configuration');
  const profile = options.profile === undefined ? 'install-only' : options.profile;
  assert.ok(['install-only', 'connected'].includes(profile), 'Unknown function profile');
  return profile === 'connected';
}
export async function prepareCandidateFunction(root, options = {}) {
  const connected = connectedFunctions(options);
  const result = await build({ absWorkingDir: repo, entryPoints: ['scripts/catalog-candidate-record.mts'],
    bundle: true, platform: 'node', format: 'esm', target: 'node20', write: false, metafile: true });
  assert.deepEqual(Object.keys(result.metafile.inputs).sort(), ['scripts/catalog-candidate-record.mts',
    'netlify/functions/_shared/catalog-install-record.ts', 'netlify/functions/_shared/mcp-library.ts', 'mcp/src/library.ts',
    'mcp/src/paging.ts', 'mcp/src/search-ranking.ts', 'mcp/src/search-ranking-policy.mjs', 'mcp/src/install-record.mjs',
    'mcp/src/catalog-tracks.ts', 'mcp/src/search-catalog.ts', 'mcp/src/search-catalog-format.mjs'].sort(),
  'Candidate record function must contain only the read-only handler and public catalog loader');
  const api = connected ? await build({ absWorkingDir: repo, entryPoints: ['scripts/connected-candidate-api.mts'],
    bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external', write: false, metafile: true }) : null;
  if (api) assert.ok(Object.keys(api.metafile.inputs).every(file => !/(?:^|\/)(?:menubar|portal)\/|\.test\.[cm]?ts$/.test(file)),
    'Connected function cannot include native, browser or test entries');
  await writeFile(join(root, 'functions/catalog-candidate-record.mjs'), result.outputFiles[0].contents, { flag: 'wx' });
  if (api) await writeFile(join(root, 'functions/connected-candidate-api.mjs'), api.outputFiles[0].contents, { flag: 'wx' });
}
export function validateFunctionPackage(manifest, root, options = {}) {
  const connected = connectedFunctions(options);
  const names = connected ? ['catalog-candidate-record', 'connected-candidate-api'] : ['catalog-candidate-record'];
  assert.deepEqual(manifest.functions.map(fn => fn.name).sort(), names);
  for (const fn of manifest.functions) {
    assert.equal(fn.runtime, 'js');
    assert.equal(fn.mainFile, join(root, `functions/${fn.name}.mjs`));
    assert.equal(fn.path, join(root, `function-check/${fn.name}.zip`));
    assert.ok(fn.schedule === undefined && fn.background !== true
      && (fn.invocationMode === undefined || fn.invocationMode === 'stream'), 'Unexpected execution mode');
    assert.ok(fn.eventSubscriptions === undefined || fn.eventSubscriptions.length === 0, 'Unexpected event handler');
    assert.ok(fn.excludedRoutes === undefined || fn.excludedRoutes.length === 0, 'Unexpected route exclusions');
    if (fn.name === 'catalog-candidate-record') {
      assert.deepEqual(fn.routes, [{ pattern: '/api/catalog/install-record', literal: '/api/catalog/install-record', methods: [] }]);
      continue;
    }
    const routes = fn.routes.map(route => ({ ...route, methods: Array.isArray(route.methods) ? [...route.methods].sort() : route.methods }))
      .sort((a, b) => a.pattern.localeCompare(b.pattern));
    const expected = candidateAccountPaths.map(pattern => ({ pattern,
      ...(pattern.endsWith('/:groupId') ? { expression: groupRouteExpression } : { literal: pattern }),
      methods: ['GET', 'OPTIONS', 'POST'] })).sort((a, b) => a.pattern.localeCompare(b.pattern));
    assert.deepEqual(routes, expected);
  }
}
export function safeDiagnostic(error, env = process.env) {
  let text = String(error.stderr ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  for (const [name, value] of Object.entries(env)) {
    if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY/i.test(name) && value?.length >= 6) text = text.replaceAll(value, '[redacted]');
  }
  text = text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/(?:nfp_|nfpat_|ghp_|sk_test_|sk_live_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return { status: error.status ?? null, diagnostic: text.trim().slice(-3000) || 'No safe stderr diagnostic available; raw stdout suppressed' };
}
function command(args, cwd = repo, json = true) {
  try {
    const output = execFileSync(cli, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      timeout: 180000, env: { ...process.env, CI: 'true', NETLIFY_SITE_ID: siteId }, stdio: ['ignore', 'pipe', 'pipe'] });
    return json ? JSON.parse(output) : output;
  } catch (error) { throw Error('Netlify command failed: ' + JSON.stringify(safeDiagnostic(error))); }
}
export function stagingConfig() {
  return '[build]\n  command = "true"\n  publish = "site"\n  functions = "functions"\n  edge_functions = "edge-functions"\n[functions]\n  directory = "functions"\n';
}
const api = (name, data) => command(['api', name, '--data', JSON.stringify(data)]);
async function get(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(45000), ...options });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}
async function sourceState() {
  return { head: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    files: await Promise.all(sourceFiles.map(async path => ({ path, sha256: sha(await readFile(join(repo, path))) }))) };
}
export async function fileInventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await fileInventory(directory, path + '/'));
    else {
      assert.ok(entry.isFile(), `Only ordinary files may be uploaded: ${path}`);
      const bytes = await readFile(join(directory, path)); files.push({ path, bytes: bytes.length, sha256: sha(bytes), sha1: sha(bytes, 'sha1') });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function verifyFileList(actual, expected, deployId) {
  assert.deepEqual(actual.filter(f => f.path !== '/netlify.toml').map(f => f.path).sort(),
    expected.filter(f => !f.path.startsWith('_')).map(f => '/' + f.path.toLowerCase()).sort(), 'Unexpected hosted files');
  for (const f of actual) {
    assert.equal(f.site_id, siteId); assert.equal(f.deploy_id, deployId);
    if (f.path === '/netlify.toml') continue; // Netlify's reserved deployment metadata; not a public payload file.
    const e = expected.find(e => '/' + e.path.toLowerCase() === f.path);
    assert.equal(f.size, e.bytes); if (e.sha1) assert.equal(f.sha, e.sha1);
  }
}
export function mergedHeaders(legacyHeaders, legacyFiles, options = {}) {
  const policy = hostingFiles(options);
  const connected = options.profile === 'connected';
  const lines = legacyHeaders.trimEnd().split('\n');
  assert.equal(lines[0], '/*');
  if (connected) {
    for (const file of legacyFiles) {
      assert.ok(typeof file.path === 'string' && file.path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part)
        && part !== '.' && part !== '..'), 'Unsupported retained header path');
      assert.ok(file.path !== 'app/connect' && !file.path.startsWith('app/connect/'), 'Retained file conflicts with connect rewrite');
    }
  }
  const paths = new Set(legacyFiles.filter(f => !f.path.startsWith('_')
    && (!connected || (f.path !== 'app/index.html' && !f.path.startsWith('app/assets/')))).map(f => '/' + f.path));
  for (const path of [...paths]) if (path.endsWith('/index.html')) paths.add(path.slice(0, -10));
  const candidateCSP = policy._headers.split('\n').find(line => line.includes('Content-Security-Policy:'));
  const candidatePaths = ['/app/', '/app/index.html', '/app/connect', '/app/assets/*'];
  const connectedBlocks = candidatePaths.map(path => `${path}\n${candidateCSP}\n`).join('');
  const cspCount = lines.filter(line => line.includes('Content-Security-Policy:')).length;
  if (connected && cspCount > 1) {
    // Recognize only the previous generator's common prefix, two-line legacy blocks and candidate tail.
    const original = hostingFiles()._headers;
    const common = original.slice(0, original.indexOf('  Content-Security-Policy:'));
    const oldCandidateCSP = original.split('\n').find(line => line.includes('Content-Security-Policy:'));
    const oldTail = ['/app/', '/app/assets/*'].map(path => `${path}\n${oldCandidateCSP}\n`).join('');
    assert.ok(legacyHeaders.startsWith(common) && legacyHeaders.endsWith(oldTail), 'Unknown retained header layout');
    const body = legacyHeaders.slice(common.length, -oldTail.length);
    const blocks = body.slice(0, -1).split('\n');
    assert.ok(body.endsWith('\n') && blocks.length >= 2 && blocks.length % 2 === 0, 'Malformed retained legacy blocks');
    const retainedCSP = "  Content-Security-Policy: default-src 'self'; img-src https://github.com https://avatars.githubusercontent.com; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
    const seen = new Set(['/*', ...candidatePaths]);
    for (let i = 0; i < blocks.length; i += 2) {
      const selector = blocks[i];
      assert.ok(paths.has(selector) && !seen.has(selector), 'Unknown or duplicate retained selector');
      assert.equal(blocks[i + 1], retainedCSP, 'Unknown retained legacy policy');
      seen.add(selector);
    }
    return legacyHeaders.slice(0, -oldTail.length) + connectedBlocks;
  }
  const legacyCSP = lines.find(line => line.trimStart().startsWith('Content-Security-Policy:'));
  assert.ok(legacyCSP && cspCount === 1);
  if (connected) {
    assert.ok(lines.slice(1).every(line => /^  [A-Za-z][A-Za-z-]*: [^\r\n]+$/.test(line)),
      'Connected merge requires one global legacy header block');
    const names = lines.slice(1).map(line => line.trimStart().split(':', 1)[0].toLowerCase());
    assert.equal(new Set(names).size, names.length, 'Duplicate legacy headers');
    assert.ok(!names.includes('content-security-policy-report-only'), 'Unsupported legacy CSP variant');
  }
  const common = lines.filter(line => line !== legacyCSP).join('\n');
  const legacy = [...paths].sort().map(path => `${path}\n${legacyCSP}`).join('\n');
  if (connected) return `${common}\n${legacy ? legacy + '\n' : ''}${connectedBlocks}`;
  return `${common}\n${legacy}\n/app/\n${candidateCSP}\n/app/assets/*\n${candidateCSP}\n`;
}
async function siteState() {
  const value = api('getSite', { site_id: siteId });
  assert.equal(value.id, siteId); assert.equal(value.name, 'omgskills-setup-test-f3b');
  assert.equal(new URL(value.ssl_url ?? value.url).hostname, new URL(candidateOrigin).hostname);
  assert.equal(value.published_deploy.id, baselineDeploy, 'Published test-site deploy changed; stop and re-plan');
  return { siteId, name: value.name, publishedDeploy: value.published_deploy.id, gitConnected: !!value.build_settings?.repo_url };
}
async function verifyServed(base, files, legacyHeaders) {
  const legacyCSP = legacyHeaders.split('\n').find(line => line.includes('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
  for (const file of files.filter(f => !f.path.startsWith('_'))) {
    const route = file.path.endsWith('/index.html') ? file.path.slice(0, -10) : file.path;
    const { response, bytes } = await get(`${base}/${route}`);
    assert.equal(response.status, 200, file.path); assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(sha(bytes), file.sha256, `Served bytes changed: ${file.path}`);
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (file.path.startsWith('app/preview/') || ['test.js', 'test.css', 'robots.txt'].includes(file.path) || file.path.startsWith('updates/f3d/') || file.path.startsWith('OMGSkills-Setup-Test-'))
      assert.equal(response.headers.get('content-security-policy'), legacyCSP, `Legacy CSP changed: ${file.path}`);
    if (file.path === 'app/index.html') {
      assert.match(response.headers.get('content-security-policy') ?? '', /font-src 'self'/);
      assert.match(response.headers.get('content-security-policy') ?? '', /style-src 'self' 'unsafe-inline'/);
    }
  }
}
function publicKey(value) {
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(value, 'base64')]), format: 'der', type: 'spki' });
}
export async function verifyRelease(ready) {
  assert.equal(ready.stage, 'signed-notarized-local-only'); assert.equal(ready.bundleID, 'com.jonslimak.omgskills');
  assert.equal(ready.feedURL, candidateOrigin + '/updates/catalog-candidate/appcast.xml');
  assert.equal(ready.versions.length, 2);
  assert.equal(sha(await readFile(join(releaseRoot, 'configuration.json'))), ready.configurationSHA256);
  assert.equal(sha(await readFile(join(releaseRoot, 'notarization-journal.json'))), ready.journalSHA256);
  const key = publicKey(ready.publicKey), seen = new Set();
  for (const v of ready.versions) {
    assert.ok(Object.hasOwn(releases, v.release) && !seen.has(v.release)); seen.add(v.release);
    assert.deepEqual([v.version, v.build], releases[v.release]); assert.equal(basename(v.archive), archiveName(v.release));
    assert.equal(await realpath(v.archive), join(releaseRoot, v.release, archiveName(v.release)));
    const bytes = await readFile(v.archive); assert.equal(bytes.length, v.bytes); assert.equal(sha(bytes), v.sha256);
    assert.ok(verify(null, bytes, key, Buffer.from(v.edSignature, 'base64')));
    assert.equal(v.gatekeeperAccepted, true); assert.equal(v.archiveRoundtripVerified, true);
  }
  const feed = await readFile(ready.feed.path); assert.equal(sha(feed), ready.feed.sha256);
  const trailer = /<!-- sparkle-signatures:\s*edSignature: ([A-Za-z0-9+/=]+)\s*length: ([0-9]+)/.exec(feed.toString());
  assert.ok(trailer && Number(trailer[2]) > 0 && Number(trailer[2]) < feed.length);
  assert.ok(verify(null, feed.subarray(0, Number(trailer[2])), key, Buffer.from(trailer[1], 'base64')));
  const a = ready.versions.find(v => v.release === 'a');
  const expected = { client: 'candidate', app: 'omgskills.app', bundleId: ready.bundleID, version: a.version, build: a.build,
    architecture: 'arm64', minimumOS: '14.0', filename: archiveName('a'), url: new URL(archiveName('a'), ready.feedURL).href, sha256: a.sha256 };
  assert.deepEqual(await readJSON(join(repo, 'portal/src/candidate/distribution.json')), expected, 'Web bootstrap does not match verified A');
}
async function preflight() {
  const state = await siteState(), baseline = await readJSON(baselinePath);
  assert.equal(baseline.siteId, siteId); assert.equal(baseline.origin, candidateOrigin);
  const source = join(baseline.staging, 'public');
  const files = await fileInventory(source);
  assert.deepEqual(files.map(({ sha1, ...f }) => f), baseline.files, 'Retained site baseline changed');
  verifyFileList(api('listSiteFiles', { site_id: siteId }), files, baselineDeploy);
  const headers = await readFile(join(source, '_headers'), 'utf8');
  await verifyServed(candidateOrigin, files, headers);
  const productionFeed = await get('https://omgskills.com/appcast.xml'); assert.equal(productionFeed.response.status, 200);
  return { state, source, files, headers, productionFeedSHA256: sha(productionFeed.bytes) };
}
export async function prepareHosting() {
  const before = await sourceState(), baseline = await preflight();
  const ready = await readJSON(join(releaseRoot, 'ready.json')); await verifyRelease(ready);
  await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = await mkdtemp(join(parent, 'candidate-')), site = join(root, 'site');
  await cp(baseline.source, site, { recursive: true, errorOnExist: true, force: false });
  const overlay = await prepareCandidateWeb();
  for (const file of await fileInventory(overlay.site)) {
    if (file.path.startsWith('_')) continue;
    const destination = join(site, file.path);
    const existing = baseline.files.find(f => f.path === file.path);
    if (existing) { assert.equal(existing.sha256, file.sha256, `Overlay would replace old file: ${file.path}`); continue; }
    await mkdir(dirname(destination), { recursive: true }); await cp(join(overlay.site, file.path), destination, { errorOnExist: true, force: false });
  }
  await writeFile(join(site, '_redirects'), hostingFiles()._redirects);
  await writeFile(join(site, '_headers'), mergedHeaders(baseline.headers, baseline.files));
  const updates = join(site, 'updates/catalog-candidate'); await mkdir(updates);
  for (const v of ready.versions) await cp(v.archive, join(updates, basename(v.archive)), { errorOnExist: true, force: false });
  await cp(ready.feed.path, join(updates, 'appcast.xml'), { errorOnExist: true, force: false });
  for (const path of ['functions', 'edge-functions']) await mkdir(join(root, path));
  await prepareCandidateFunction(root);
  await writeFile(join(root, 'netlify.toml'), stagingConfig(), { flag: 'wx' });
  const files = await fileInventory(site);
  for (const old of baseline.files.filter(f => !f.path.startsWith('_'))) assert.deepEqual(files.find(f => f.path === old.path), old, 'Old payload changed');
  assert.deepEqual(await sourceState(), before, 'Source changed during preparation');
  const result = { stage: 'prepared-not-uploaded', root, site, siteId, origin: candidateOrigin, baseline, source: before,
    files, functions: await fileInventory(join(root, 'functions')),
    releaseReceiptSHA256: sha(await readFile(join(releaseRoot, 'ready.json'))), overlay,
    configSHA256: sha(await readFile(join(root, 'netlify.toml'))), bootstrap: 'a', hosted: false, published: false, installed: false };
  await save(join(root, 'preparation.json'), result);
  return { root, files: files.length, stage: result.stage };
}
export function draftArguments(site) {
  return ['deploy', '--site', siteId, '--dir', site, '--functions', join(dirname(site), 'functions'),
    '--no-build', '--json', '--message', 'Catalog candidate 3C draft only'];
}
async function retained(raw) {
  assert.ok(raw); const root = await realpath(resolve(raw));
  assert.equal(dirname(root), await realpath(parent)); assert.match(basename(root), /^candidate-[A-Za-z0-9]+$/);
  const p = await readJSON(join(root, 'preparation.json')); assert.equal(p.root, root); assert.equal(p.site, join(root, 'site'));
  assert.equal(p.siteId, siteId); assert.equal(p.origin, candidateOrigin); assert.equal(p.bootstrap, 'a');
  assert.equal(await readFile(join(root, 'netlify.toml'), 'utf8'), stagingConfig());
  assert.equal(sha(await readFile(join(root, 'netlify.toml'))), p.configSHA256);
  assert.deepEqual(await fileInventory(p.site), p.files); assert.deepEqual(await sourceState(), p.source);
  assert.deepEqual(await fileInventory(join(root, 'functions')), p.functions);
  assert.deepEqual(p.functions.map(f => f.path), ['catalog-candidate-record.mjs']);
  assert.deepEqual(await fileInventory(join(root, 'edge-functions')), []);
  assert.equal(sha(await readFile(join(releaseRoot, 'ready.json'))), p.releaseReceiptSHA256);
  await verifyRelease(await readJSON(join(releaseRoot, 'ready.json'))); await siteState();
  return p;
}
export async function dryHosting(root) {
  const p = await retained(root);
  const output = command(['build', '--dry', '--context', 'deploy-preview'], p.root, false);
  const functionOutput = command(['functions:build', '--src', join(p.root, 'functions'),
    '--functions', join(p.root, 'function-check')], p.root, false);
  const packagedFunctions = await fileInventory(join(p.root, 'function-check'));
  assert.deepEqual(packagedFunctions.map(f => f.path), ['catalog-candidate-record.zip', 'manifest.json']);
  validateFunctionPackage(await readJSON(join(p.root, 'function-check/manifest.json')), p.root);
  assert.ok(!output.includes('Multiple possible build commands'), 'Unexpected build inference prompt');
  assert.deepEqual(await fileInventory(p.site), p.files, 'Dry check changed prepared payload');
  const receipt = { stage: 'local-dry-check-passed', siteId, configSHA256: p.configSHA256,
    preparationSHA256: sha(await readFile(join(p.root, 'preparation.json'))), outputSHA256: sha(output),
    functionOutputSHA256: sha(functionOutput), packagedFunctions, published: false };
  await save(join(p.root, 'dry-check.json'), receipt); return receipt;
}
export function validateDraftDeploy(deploy, id) {
  assert.equal(deploy.id, id); assert.equal(deploy.site_id, siteId); assert.equal(deploy.state, 'ready');
  assert.equal(deploy.published_at, null, 'Deploy was unexpectedly published');
  assert.equal(deploy.deploy_ssl_url, `https://${id}--${new URL(candidateOrigin).hostname}`);
}
export async function draftHosting(root, { approved = false } = {}) {
  assert.equal(approved, true, 'Draft upload requires explicit approval');
  const p = await retained(root), journal = join(p.root, 'draft.json');
  const dry = await readJSON(join(p.root, 'dry-check.json'));
  assert.equal(dry.stage, 'local-dry-check-passed'); assert.equal(dry.siteId, siteId);
  assert.equal(dry.configSHA256, p.configSHA256);
  assert.equal(dry.preparationSHA256, sha(await readFile(join(p.root, 'preparation.json'))));
  assert.deepEqual(await fileInventory(join(p.root, 'function-check')), dry.packagedFunctions);
  // Persist intent before upload; an unknown outcome must be reconciled, never blindly repeated.
  await save(journal, { status: 'upload-outcome-unknown', siteId, source: p.source.head });
  const result = command(draftArguments(p.site), p.root);
  assert.equal(result.site_id, siteId); assert.match(result.deploy_id, /^[a-f0-9]{24}$/);
  assert.equal(result.deploy_url, `https://${result.deploy_id}--${new URL(candidateOrigin).hostname}`);
  const deploy = api('getDeploy', { deploy_id: result.deploy_id });
  validateDraftDeploy(deploy, result.deploy_id);
  await writeFile(journal, JSON.stringify({ status: 'draft-ready-not-published', siteId, deployId: result.deploy_id,
    url: result.deploy_url, preparationSHA256: sha(await readFile(join(p.root, 'preparation.json'))) }, null, 2) + '\n', { mode: 0o600 });
  await siteState(); return { deployId: result.deploy_id, url: result.deploy_url, published: false };
}
export async function verifyDraft(root) {
  const p = await retained(root), draft = await readJSON(join(p.root, 'draft.json'));
  assert.equal(draft.status, 'draft-ready-not-published'); assert.equal(draft.siteId, siteId);
  assert.equal(draft.preparationSHA256, sha(await readFile(join(p.root, 'preparation.json'))));
  assert.equal(draft.url, `https://${draft.deployId}--${new URL(candidateOrigin).hostname}`);
  await verifyServed(draft.url, p.files, p.baseline.headers);
  const route = async (path, status, options) => { const value = await get(draft.url + path, options); assert.equal(value.response.status, status, path); return value; };
  const rootResponse = await route('/', 302); assert.equal(new URL(rootResponse.response.headers.get('location'), draft.url).pathname, '/app/');
  for (const path of ['/api/portal/skills', '/app/connect', '/not-a-real-route', '/netlify.toml']) await route(path, 404);
  const id = 'anthropics/skills:skills/frontend-design';
  const found = await route('/api/catalog/install-record?id=' + encodeURIComponent(id), 200);
  assert.match(found.response.headers.get('cache-control') ?? '', /no-store/);
  assert.match(found.response.headers.get('x-robots-tag') ?? '', /noindex/);
  assert.equal(JSON.parse(found.bytes).skill?.id, id);
  assert.equal(JSON.parse(found.bytes).found, true);
  const absent = await route('/api/catalog/install-record?id=omgskills-no-such-3c-test/skill', 200);
  assert.equal(JSON.parse(absent.bytes).found, false);
  await route('/api/catalog/install-record', 400);
  await route('/api/catalog/install-record?id=' + encodeURIComponent(id), 405, { method: 'POST' });
  const health = await route('/mcp/health', 200); assert.ok(JSON.parse(health.bytes).skillCount > 0);
  const detail = await route('/mcp', 200, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_skill', arguments: { id } } }) });
  assert.ok(!JSON.parse(detail.bytes).error);
  let collectionsVerified = false;
  for (const track of ['crawl4', 'v2']) {
    const manifest = await get(`${draft.url}/data/${track}/manifest.json`);
    if (manifest.response.status === 404) continue;
    assert.equal(manifest.response.status, 200); const value = JSON.parse(manifest.bytes);
    assert.match(value.collections.path, /^collections(?:-[a-f0-9]+)?\.json$/);
    await route(`/data/${track}/${value.collections.path}`, 200); collectionsVerified = true; break;
  }
  assert.ok(collectionsVerified, 'No working public collections manifest');
  const links = await route('/catalog-skill-urls.json', 200); assert.ok(JSON.parse(links.bytes).skills);
  const production = await get('https://omgskills.com/appcast.xml'); assert.equal(sha(production.bytes), p.baseline.productionFeedSHA256);
  await siteState();
  const receipt = { stage: 'draft-http-verified-not-published', siteId, deployId: draft.deployId, url: draft.url,
    filesChecked: p.files.filter(f => !f.path.startsWith('_')).length, oldPayloadUnchanged: true, legacyHeadersPreserved: true,
    candidateHeadersVerified: true, queryForwardingVerified: true, publicCatalogRoutesVerified: true,
    candidateRecordFunctionVerified: true,
    productionFeedUnchanged: true, publishedDeployUnchanged: baselineDeploy, published: false, installed: false,
    limitations: ['Exact-origin browser guard stays unchanged; draft origin cannot activate candidate UI.',
      'Native browser handoff, fresh setup and app replacement require separately approved test-site publication and VM acceptance.'] };
  await save(join(p.root, 'draft-verification.json'), receipt); return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { stage: { type: 'string' }, root: { type: 'string' }, approved: { type: 'boolean', default: false } } });
  assert.ok(['prepare', 'dry', 'draft', 'verify'].includes(values.stage), 'Use --stage prepare, dry, draft or verify; publication is not supported');
  const result = values.stage === 'prepare' ? await prepareHosting() : values.stage === 'dry' ? await dryHosting(values.root) : values.stage === 'draft'
    ? await draftHosting(values.root, { approved: values.approved }) : await verifyDraft(values.root);
  console.log(JSON.stringify(result, null, 2));
}
