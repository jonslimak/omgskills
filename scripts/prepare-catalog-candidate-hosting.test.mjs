import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { siteId, baselineDeploy, verifyFileList, mergedHeaders, fileInventory, draftArguments, draftHosting, verifyRelease,
  stagingConfig, validateDraftDeploy, safeDiagnostic, prepareCandidateFunction, validateFunctionPackage } from './prepare-catalog-candidate-hosting.mjs';
import { hostingFiles } from './prepare-catalog-candidate-web.mjs';

test('record route is local to the test site, never proxied to the unavailable production endpoint', () => {
  assert.doesNotMatch(hostingFiles()._redirects, /install-record/);
});
test('Netlify function manifest contains exactly the intended read-only record route', () => {
  const root = '/private/tmp/example';
  const fn = { name: 'catalog-candidate-record', runtime: 'js', mainFile: root + '/functions/catalog-candidate-record.mjs',
    path: root + '/function-check/catalog-candidate-record.zip',
    routes: [{ pattern: '/api/catalog/install-record', literal: '/api/catalog/install-record', methods: [] }] };
  validateFunctionPackage({ functions: [fn] }, root);
  for (const change of [{ routes: [] }, { routes: [{ pattern: '/api/portal/*' }] }, { path: '/wrong.zip' }])
    assert.throws(() => validateFunctionPackage({ functions: [{ ...fn, ...change }] }, root));
  assert.throws(() => validateFunctionPackage({ functions: [fn, fn] }, root));
});
test('prepared record function reuses the raw contract and only reads public catalog data', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'candidate-record-test-')));
  try {
    await mkdir(join(root, 'functions'));
    await prepareCandidateFunction(root);
    const files = await fileInventory(join(root, 'functions'));
    assert.deepEqual(files.map(f => f.path), ['catalog-candidate-record.mjs']);
    const source = await readFile(join(root, 'functions', files[0].path), 'utf8');
    assert.doesNotMatch(source, /@clerk|DATABASE_URL|omgskills-mcp/);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = String(input); calls.push(url); assert.equal(options?.method, undefined);
      assert.ok(url.startsWith('https://omgskills.com/data/crawl4/')
        || url === 'https://raw.githubusercontent.com/jonslimak/omgskills/main/index/gold-basket.json');
      if (url.endsWith('/manifest.json')) return Response.json({ skills: { path: 'skills.json' } });
      if (url.endsWith('/skills.json')) return Response.json([{
        id: 'example/repo:one', name: 'one', description: 'Fixture', author_handle: 'example',
        github_url: 'https://github.com/example/repo', install_cmd: 'npx skills add example/repo',
        skill_md_path: '.skills/one/SKILL.md', repo_commit_sha: 'a'.repeat(40), tags: ['not-in-contract']
      }]);
      return new Response('Missing', { status: 404 });
    });
    const { default: handler, config } = await import(pathToFileURL(join(root, 'functions', files[0].path)).href);
    assert.equal(config.path, '/api/catalog/install-record');
    const context = { site: { id: siteId }, waitUntil: () => {} };
    const request = (q = '', method = 'GET', path = config.path) => new Request('https://example.test' + path + q, { method });
    assert.equal((await handler(request('?id=example/repo:one'), { ...context, site: { id: 'wrong' } })).status, 404);
    assert.equal((await handler(request('', 'GET', '/api/portal/skills'), context)).status, 404);
    assert.equal((await handler(request(), context)).status, 400);
    assert.equal((await handler(request('?id=a&id=b'), context)).status, 400);
    assert.equal((await handler(request('?id=a', 'POST'), context)).status, 405);
    assert.equal(calls.length, 0);
    const response = await handler(request('?id=example/repo:one'), context);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    const body = await response.json(); assert.equal(body.version, 1); assert.equal(body.found, true);
    assert.equal(body.skill.id, 'example/repo:one'); assert.equal(body.skill.skill_md_path, '.skills/one/SKILL.md');
    assert.equal(body.skill.repo_commit_sha, 'a'.repeat(40)); assert.ok(!('tags' in body.skill));
    assert.ok(!('skill_tree_sha' in body.skill), 'Partial pins must not become complete');
    const absent = await handler(request('?id=missing'), context);
    assert.deepEqual(await absent.json(), { version: 1, found: false, skill: null });
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline fixture'); });
    const offline = await import(pathToFileURL(join(root, 'functions', files[0].path)).href + '?offline');
    const failed = await offline.default(request('?id=example/repo:one'), context);
    assert.equal(failed.status, 503); assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.match(failed.headers.get('x-robots-tag'), /noindex/);
  } finally { await rm(root, { recursive: true }); }
});

test('isolated staging explicitly selects a no-op build instead of framework inference', () => {
  const config = stagingConfig();
  assert.match(config, /^\[build\]\n  command = "true"\n/);
  assert.match(config, /publish = "site"/); assert.match(config, /directory = "functions"/);
  assert.doesNotMatch(config, /omgskills\.com|npm |hugo|zola|plugins|environment/);
});
test('non-publication is verified from real API fields, not a nonexistent draft flag', () => {
  const id = '0123456789abcdef01234567';
  const good = { id, site_id: siteId, state: 'ready', published_at: null,
    deploy_ssl_url: `https://${id}--omgskills-setup-test-f3b.netlify.app` };
  validateDraftDeploy(good, id);
  for (const change of [{ published_at: '2026-10-15T00:00:00Z' }, { published_at: undefined },
    { site_id: 'wrong' }, { id: 'wrong' }, { state: 'error' }, { deploy_ssl_url: 'https://omgskills.com' }])
    assert.throws(() => validateDraftDeploy({ ...good, ...change }, id));
});
test('failure diagnostics preserve useful errors but redact credentials and raw stdout', () => {
  const value = safeDiagnostic({ status: 13, stderr: '\x1b[31mError: build prompt\x1b[0m\nBearer abc123\nnfp_token123\nexample-secret\n-----BEGIN PRIVATE KEY-----\nsensitive\n-----END PRIVATE KEY-----',
    stdout: 'private stdout' }, { NETLIFY_AUTH_TOKEN: 'example-secret' });
  assert.equal(value.status, 13); assert.match(value.diagnostic, /Error: build prompt/);
  assert.doesNotMatch(value.diagnostic, /abc123|nfp_token123|example-secret|sensitive|private stdout|\x1b/);
  assert.match(safeDiagnostic({ stdout: 'must stay private' }).diagnostic, /stdout suppressed/);
});

test('draft command is fixed to the dedicated site with explicit isolated paths and no publication flags', () => {
  const args = draftArguments('/private/tmp/example/site');
  assert.ok(args.includes(siteId)); assert.ok(args.includes('--no-build'));
  assert.ok(!args.includes('--context'), 'Netlify rejects --context combined with --no-build');
  assert.equal(args[args.indexOf('--functions') + 1], '/private/tmp/example/functions');
  assert.equal(args[args.indexOf('--dir') + 1], '/private/tmp/example/site');
  assert.ok(!args.some(x => ['--prod', '--prod-if-unlocked', '--trigger', '--open', '--allow-anonymous', '--create-site'].includes(x)));
});
test('inventory accepts only the exact baseline payload plus reserved Netlify metadata', () => {
  const expected = [{ path: 'Example.zip', bytes: 12, sha1: 'abc' }, { path: '_headers', bytes: 9 }];
  const files = [{ path: '/example.zip', size: 12, sha: 'abc', site_id: siteId, deploy_id: baselineDeploy },
    { path: '/netlify.toml', size: 9, site_id: siteId, deploy_id: baselineDeploy }];
  verifyFileList(files, expected, baselineDeploy);
  for (const changes of [{ path: '/extra.zip' }, { size: 13 }, { sha: 'wrong' }, { site_id: 'production' }, { deploy_id: 'changed' }])
    assert.throws(() => verifyFileList([{ ...files[0], ...changes }, files[1]], expected, baselineDeploy));
  assert.throws(() => verifyFileList([files[1]], expected, baselineDeploy));
});
test('candidate CSP never becomes a global restriction on old test pages', () => {
  const old = "/*\n  X-Robots-Tag: noindex\n  Content-Security-Policy: default-src 'self'; style-src 'self'\n";
  const result = mergedHeaders(old, [{ path: 'app/preview/unified/index.html' }, { path: 'updates/f3d/appcast.xml' }, { path: '_headers' }]);
  assert.match(result, /^\/\*\n  X-Robots-Tag: noindex\n\/app\/preview/);
  assert.match(result, /\/app\/preview\/unified\/\n  Content-Security-Policy: default-src 'self'; style-src 'self'/);
  assert.match(result, /\/updates\/f3d\/appcast.xml\n  Content-Security-Policy: default-src 'self'; style-src 'self'/);
  assert.match(result, /\/app\/\n  Content-Security-Policy: .*font-src 'self'/);
  assert.match(result, /\/app\/assets\/\*\n  Content-Security-Policy:/);
  assert.throws(() => mergedHeaders('/*\n  Missing: CSP', []));
});
test('publish payload inventory refuses symlinks and records bytes independently', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'candidate-hosting-test-')));
  try {
    await mkdir(join(root, 'sub')); await writeFile(join(root, 'sub/test.txt'), 'fixture');
    const files = await fileInventory(root); assert.equal(files.length, 1); assert.equal(files[0].bytes, 7);
    assert.match(files[0].sha256, /^[a-f0-9]{64}$/); assert.match(files[0].sha1, /^[a-f0-9]{40}$/);
    await symlink('sub/test.txt', join(root, 'redirected')); await assert.rejects(fileInventory(root), /ordinary files/);
  } finally { await rm(root, { recursive: true }); }
});
test('invalid release receipt or missing upload approval stops before remote actions', async () => {
  await assert.rejects(draftHosting('/tmp/anything'), /approval/);
  for (const value of [{}, { stage: 'signed-notarized-local-only', bundleID: 'wrong' },
    { stage: 'signed-notarized-local-only', bundleID: 'com.jonslimak.omgskills', feedURL: 'https://omgskills.com/appcast.xml' }])
    await assert.rejects(verifyRelease(value));
  const result = spawnSync(process.execPath, [new URL('./prepare-catalog-candidate-hosting.mjs', import.meta.url).pathname, '--stage', 'publish'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /deploy_url|Deploy is live/);
});
