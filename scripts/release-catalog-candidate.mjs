#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { appName, inspectionPublicKey, metadata as inspectionMetadata, updateFeed, website } from './prepare-catalog-candidate.mjs';
import { assemblePackage, inspectPackage, inventory } from './prepare-newmac-setup-test.mjs';
import { entitlementsJSON, parseSignature, signTargets, unsignedExecutableHash, verifyEntitlements } from '../experiments/browser-handoff/verify-release.mjs';
import { FinalizationJournal } from '../experiments/browser-handoff/finalize-helper.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = join(repo, 'menubar/.build/catalog-candidate-releases');
const tools = join(repo, 'menubar/.build/catalog-candidate/artifacts/sparkle/Sparkle/bin');
const identity = 'AC26B6BFBB232FC72D30A9A27CA5EF565894DFE4';
const teamID = 'S4R7UHY755';
export const account = 'com.jonslimak.omgskills.catalog-candidate.20261015';
export const releases = Object.freeze({ a: ['0.0.21', '21'], b: ['0.0.22', '22'] });
const sourceFiles = ['scripts/release-catalog-candidate.mjs', 'scripts/release-catalog-candidate.test.mjs',
  'scripts/prepare-catalog-candidate.mjs', 'scripts/prepare-catalog-candidate.test.mjs',
  'scripts/prepare-newmac-setup-test.mjs', 'scripts/prepare-newmac-setup-test.test.mjs',
  'experiments/browser-handoff/verify-release.mjs', 'experiments/browser-handoff/verify-candidate.mjs',
  'experiments/browser-handoff/finalize-helper.mjs', 'experiments/browser-handoff/release-contract.mjs',
  'menubar/Tests/omgskillsTests/CatalogCandidatePackageTests.swift', 'menubar/Info.plist'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = path => sha(readFileSync(path));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

// Credential-bearing command arguments and private-key tool output never enter diagnostics.
function run(command, args, options = {}) {
  if (command === '/usr/bin/xcrun' && args[0] === 'notarytool') {
    const index = args.indexOf('--keychain-profile');
    assert.equal(args[index + 1], 'candidate-environment');
    for (const name of ['ASC_PRIVATE_KEY_PATH', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) assert.ok(process.env[name], `${name} is unset`);
    args = [...args.slice(0, index), '--key', process.env.ASC_PRIVATE_KEY_PATH,
      '--key-id', process.env.ASC_KEY_ID, '--issuer', process.env.ASC_ISSUER_ID, ...args.slice(index + 2)];
  }
  try { return execFileSync(command, args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  catch { throw Error(`${basename(command)} failed; stopped without printing arguments or private output`); }
}
const plist = path => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path]));
const productionKey = () => plist(join(repo, 'menubar/Info.plist')).SUPublicEDKey;
const publicKeyObject = key => createPublicKey({ key: Buffer.concat([
  Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64')]), format: 'der', type: 'spki' });

export function releaseMetadata(release, publicKey, publicAppKey) {
  assert.ok(Object.hasOwn(releases, release), 'Use the approved candidate release a or b');
  assert.equal(typeof publicKey, 'string');
  const bytes = Buffer.from(publicKey, 'base64');
  assert.ok(bytes.length === 32 && new Set(bytes).size > 1 && bytes.toString('base64') === publicKey,
    'Use a canonical, non-synthetic candidate public key');
  assert.ok(typeof publicAppKey === 'string' && publicAppKey.length > 0, 'Production key is required for separation check');
  assert.notEqual(publicKey, publicAppKey, 'Never reuse the production update key');
  assert.notEqual(publicKey, inspectionPublicKey);
  const [version, build] = releases[release];
  return { ...inspectionMetadata(), CFBundleShortVersionString: version, CFBundleVersion: build,
    SUPublicEDKey: publicKey, OMGSkillsCatalogCandidateUpdatePublicKey: publicKey };
}

export function validateReleaseMetadata(value, release, key, publicAppKey) {
  assert.deepEqual(value, releaseMetadata(release, key, publicAppKey), 'Unexpected candidate release metadata');
}

export function archiveName(release) {
  assert.ok(Object.hasOwn(releases, release));
  const [version, build] = releases[release];
  return `OMGSkills-Catalog-Candidate-${version}-${build}-arm64.zip`;
}

export function exportPrivateBackup(tool, destination, execute = run) {
  assert.ok(!existsSync(destination), 'Private backup destination must not exist');
  assert.equal(lstatSync(dirname(destination)).mode & 0o777, 0o700, 'Private backup directory required');
  assert.equal(realpathSync(dirname(destination)), dirname(destination));
  // Sparkle requires a new path. The private parent protects bytes before chmod.
  try { execute(tool, ['--account', account, '-x', destination]); }
  finally { if (existsSync(destination)) chmodSync(destination, 0o600); }
  assert.ok(lstatSync(destination).isFile() && statSync(destination).size > 0, 'Private backup is empty');
}

export function renderFeed(versions) {
  assert.equal(versions.length, 2);
  const found = new Set();
  const items = versions.map(v => {
    assert.ok(Object.hasOwn(releases, v.release) && !found.has(v.release)); found.add(v.release);
    assert.deepEqual([v.version, v.build], releases[v.release]);
    assert.equal(basename(v.archive), archiveName(v.release));
    assert.ok(Number.isSafeInteger(v.bytes) && v.bytes > 0);
    assert.equal(typeof v.edSignature, 'string');
    const signature = Buffer.from(v.edSignature, 'base64');
    assert.ok(signature.length === 64 && signature.toString('base64') === v.edSignature);
    return `    <item><title>${v.version}</title><sparkle:version>${v.build}</sparkle:version>
      <sparkle:shortVersionString>${v.version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
      <enclosure url="${new URL(archiveName(v.release), updateFeed).href}" length="${v.bytes}" type="application/octet-stream"
        sparkle:installationType="application" sparkle:edSignature="${v.edSignature}"/>
    </item>`;
  }).reverse().join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel><title>OMGSkills Catalog Candidate</title>\n${items}\n  </channel>
</rss>\n`;
}

function sourceState() {
  return { head: run('/usr/bin/git', ['rev-parse', 'HEAD']).trim(),
    status: run('/usr/bin/git', ['status', '--porcelain=v1']),
    diffSHA256: sha(run('/usr/bin/git', ['diff', 'HEAD', '--binary'])),
    files: sourceFiles.map(path => ({ path, sha256: hash(join(repo, path)) })),
    nativeSources: inventory(join(repo, 'menubar/Sources')),
    toolHashes: ['generate_keys', 'sign_update'].map(name => ({ name, sha256: hash(join(tools, name)) })) };
}

function checkRoot(value) {
  assert.ok(value, 'A retained release root is required');
  const root = resolve(value);
  assert.equal(realpathSync(root), root);
  assert.equal(dirname(root), realpathSync(parent));
  assert.match(basename(root), /^candidate-[A-Za-z0-9]+$/);
  return root;
}

function boundary(root) {
  const c = json(join(root, 'configuration.json'));
  assert.equal(c.schema, 1); assert.equal(c.account, account);
  assert.equal(c.identity, identity); assert.equal(c.teamID, teamID);
  assert.equal(c.website, website); assert.equal(c.updateFeed, updateFeed);
  assert.deepEqual(c.source, sourceState(), 'Source changed; stop and re-plan');
  assert.equal(run(join(tools, 'generate_keys'), ['--account', account, '-p']).trim(), c.publicKey);
  for (const release of Object.keys(releases)) releaseMetadata(release, c.publicKey, productionKey());
  assert.equal(lstatSync(c.privateBackup).mode & 0o777, 0o600);
  assert.ok(lstatSync(c.privateBackup).isFile() && realpathSync(c.privateBackup) === c.privateBackup);
  assert.equal(hash(c.privateBackup), c.privateBackupSHA256, 'Local private backup changed');
  return c;
}

function signatureInfo(path) {
  return run('/bin/zsh', ['-c', 'exec /usr/bin/codesign --display --verbose=4 "$1" 2>&1', 'signature-info', path]);
}

function payload(app, binaries, scratch) {
  return inventory(app).filter(e => !e.path.split('/').includes('_CodeSignature') && e.path !== 'Contents/CodeResources')
    .map(e => {
      if (!binaries.includes(e.path)) return e;
      const { bytes, sha256, ...rest } = e;
      return { ...rest, normalizedSHA256: unsignedExecutableHash(join(app, e.path), run, scratch) };
    });
}

function inspect(app, c, p, stapled = false) {
  const result = inspectPackage(app, { executable: 'omgskills',
    validateMetadata: info => validateReleaseMetadata(info, p.release, c.publicKey, productionKey()),
    requiredSymbols: ['CatalogInstallWindowController', 'CatalogCandidateUpdater'], forbiddenSymbols: ['PublicSkillInstallWindowController'] });
  for (const relative of signTargets) {
    parseSignature(signatureInfo(join(app, relative)), { identifier: p.identifiers[relative], teamID });
    verifyEntitlements(relative, entitlementsJSON(run, join(app, relative)));
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  assert.deepEqual(payload(app, p.binaries, p.scratch), p.payload, 'Signing changed payload/layout/modes');
  if (stapled) {
    run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  }
  return result;
}

function cleanZip(app, destination) {
  assert.ok(!existsSync(destination), 'Refuse to overwrite an archive');
  run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', app, destination]);
  const entries = run('/usr/bin/unzip', ['-Z1', destination]).trim().split('\n');
  assert.ok(entries.every(path => path.startsWith(`${appName}/`) && !path.split('/').some(x => ['..', '__MACOSX'].includes(x) || x.startsWith('._'))));
}

export function prepareRelease({ approved = false } = {}) {
  assert.equal(approved, true, 'Candidate key creation and signing require approval');
  assert.equal(process.platform, 'darwin');
  const source = sourceState();
  assert.ok(run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']).includes(`${identity} "Developer ID Application: tecachapa inc (${teamID})"`));
  const access = JSON.parse(run('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', 'candidate-environment', '--output-format', 'json']));
  assert.ok(Array.isArray(access.history), 'Apple access check failed');
  mkdirSync(parent, { recursive: true }); assert.equal(realpathSync(parent), parent);
  const root = mkdtempSync(join(parent, 'candidate-'));
  // Backups live outside release/upload output, under private directories and file permissions.
  const secrets = join(repo, 'menubar/.build/catalog-candidate-private');
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(secrets), secrets); chmodSync(secrets, 0o700);
  const privateRoot = mkdtempSync(join(secrets, 'key-'));
  const privateBackup = join(privateRoot, 'catalog-candidate-sparkle-private-key.txt');
  run(join(tools, 'generate_keys'), ['--account', account]);
  const publicKey = run(join(tools, 'generate_keys'), ['--account', account, '-p']).trim();
  releaseMetadata('a', publicKey, productionKey());
  exportPrivateBackup(join(tools, 'generate_keys'), privateBackup);
  const challenge = join(privateRoot, 'backup-verification.bin');
  writeFileSync(challenge, 'OMGSkills catalog candidate backup verification\n', { flag: 'wx', mode: 0o600 });
  const signature = run(join(tools, 'sign_update'), ['--ed-key-file', privateBackup, '-p', challenge]).trim();
  assert.ok(verify(null, readFileSync(challenge), publicKeyObject(publicKey), Buffer.from(signature, 'base64')), 'Private backup does not match public key');
  const c = { schema: 1, source, account, publicKey, identity, teamID, website, updateFeed,
    privateBackup, privateBackupSHA256: hash(privateBackup), backupScope: 'local-only; no off-device backup verified' };
  save(join(root, 'configuration.json'), c);
  console.log(`Candidate output: ${root}`);
  boundary(root);
  for (const release of Object.keys(releases)) {
    const info = releaseMetadata(release, publicKey, productionKey());
    const prepared = assemblePackage({ plist: info, appName, executable: 'omgskills',
      validateMetadata: value => validateReleaseMetadata(value, release, publicKey, productionKey()),
      buildArgs: ['build', '--jobs', '2', '--scratch-path', '.build/catalog-candidate', '-c', 'release', '--arch', 'arm64',
        '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE'],
      buildDirectory: '.build/catalog-candidate/arm64-apple-macosx/release', outputDirectory: 'catalog-candidate-packages',
      requiredSymbols: ['CatalogInstallWindowController', 'CatalogCandidateUpdater'], forbiddenSymbols: ['PublicSkillInstallWindowController'],
      sourceFiles, additionalLimitations: ['Unsigned candidate release input; signing/notarization and archive verification are separate stages.',
        'Real product identity/storage: VM only; never launch or register on the host.'] });
    boundary(root);
    const directory = join(root, release); mkdirSync(directory);
    const app = join(directory, appName);
    cpSync(prepared.app, app, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
    assert.deepEqual(inventory(app), inventory(prepared.app));
    const artifact = json(join(prepared.output, 'artifact-manifest.json'));
    const binaries = artifact.binaries.map(e => e.path), scratch = join(directory, 'scratch');
    const baseline = payload(app, binaries, scratch), identifiers = {}, entitlements = {};
    for (const relative of signTargets) {
      identifiers[relative] = relative === '.' ? info.CFBundleIdentifier : /^Identifier=(.+)$/m.exec(signatureInfo(join(app, relative)))?.[1];
      assert.ok(identifiers[relative]);
      const value = entitlementsJSON(run, join(app, relative)); verifyEntitlements(relative, value);
      if (Object.keys(value).length) {
        const path = join(directory, `entitlements-${sha(relative)}.plist`);
        save(path, value); run('/usr/bin/plutil', ['-convert', 'xml1', path]); entitlements[relative] = path;
      }
    }
    const p = { release, app, prepared, binaries, scratch, payload: baseline, identifiers };
    save(join(directory, 'prepared.json'), p);
    for (const relative of signTargets) {
      const args = ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, '--identifier', identifiers[relative]];
      if (entitlements[relative]) args.push('--entitlements', entitlements[relative]);
      run('/usr/bin/codesign', [...args, join(app, relative)]);
    }
    save(join(directory, 'signed-manifest.json'), inspect(app, c, p));
    const zip = join(directory, 'apple-submission.zip'); cleanZip(app, zip);
    save(join(directory, 'signed.json'), { zip, sha256: hash(zip), preparedSHA256: hash(join(directory, 'prepared.json')),
      manifestSHA256: hash(join(directory, 'signed-manifest.json')) });
    console.log(`Signed and verified ${info.CFBundleShortVersionString} (${info.CFBundleVersion})`);
  }
  boundary(root);
  return { root, stage: 'signed-local-only; Apple submission not yet started' };
}

function retained(root, release) {
  const dir = join(root, release), signed = json(join(dir, 'signed.json'));
  assert.equal(hash(join(dir, 'prepared.json')), signed.preparedSHA256);
  assert.equal(hash(join(dir, 'signed-manifest.json')), signed.manifestSHA256);
  assert.equal(hash(signed.zip), signed.sha256);
  const p = json(join(dir, 'prepared.json'));
  assert.equal(p.app, join(dir, appName)); assert.equal(p.release, release);
  assert.equal(p.scratch, join(dir, 'scratch'));
  return { dir, signed, p };
}

export function notarizeRelease(rawRoot, { approved = false } = {}) {
  assert.equal(approved, true, 'Apple upload requires approval');
  const root = checkRoot(rawRoot), c = boundary(root);
  const journal = new FinalizationJournal(join(root, 'notarization-journal.json'), hash(join(root, 'configuration.json')), run);
  for (const release of Object.keys(releases)) {
    const { dir, signed, p } = retained(root, release); inspect(p.app, c, p);
    journal.notarize(release, signed.zip, 'candidate-environment', join(dir, 'apple-log.json'));
    console.log(`Apple accepted candidate ${release.toUpperCase()}`);
  }
  boundary(root);
}

export function finishRelease(rawRoot) {
  const root = checkRoot(rawRoot), c = boundary(root);
  assert.ok(!existsSync(join(root, 'ready.json')), 'Do not overwrite a finalized candidate');
  const j = new FinalizationJournal(join(root, 'notarization-journal.json'), hash(join(root, 'configuration.json')), run);
  const versions = [];
  for (const release of Object.keys(releases)) {
    const { dir, p } = retained(root, release);
    assert.equal(j.state.submissions[release]?.status, 'accepted');
    assert.equal(hash(join(dir, 'apple-log.json')), j.state.submissions[release].logSHA256);
    j.step(`${release}:staple`, () => {
      inspect(p.app, c, p); run('/usr/bin/xcrun', ['stapler', 'staple', p.app]);
      save(join(dir, 'final-manifest.json'), inspect(p.app, c, p, true));
      return { manifestSHA256: hash(join(dir, 'final-manifest.json')) };
    });
    assert.equal(hash(join(dir, 'final-manifest.json')), j.state.steps[`${release}:staple`].result.manifestSHA256);
    inspect(p.app, c, p, true);
    const zip = join(dir, archiveName(release));
    j.step(`${release}:archive`, () => { cleanZip(p.app, zip); return { sha256: hash(zip) }; });
    assert.equal(hash(zip), j.state.steps[`${release}:archive`].result.sha256);
    const edSignature = run(join(tools, 'sign_update'), ['--account', account, '-p', zip]).trim();
    run(join(tools, 'sign_update'), ['--account', account, '--verify', zip, edSignature]);
    assert.ok(verify(null, readFileSync(zip), publicKeyObject(c.publicKey), Buffer.from(edSignature, 'base64')));
    j.step(`${release}:roundtrip`, () => {
      const extracted = join(dir, 'archive-verification'); mkdirSync(extracted);
      run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
      const app = join(extracted, appName);
      assert.deepEqual(inventory(app), inventory(p.app)); inspect(app, c, p, true);
      return { verified: true };
    });
    const [version, build] = releases[release];
    versions.push({ release, version, build, archive: zip, bytes: statSync(zip).size, sha256: hash(zip), edSignature,
      notarizationID: j.state.submissions[release].id, payloadUnchanged: true, archiveRoundtripVerified: true,
      gatekeeperAccepted: true });
  }
  const feed = join(root, 'appcast.xml');
  j.step('feed', () => {
    writeFileSync(feed, renderFeed(versions), { flag: 'wx', mode: 0o600 });
    run('/usr/bin/xmllint', ['--nonet', '--noout', feed]);
    run(join(tools, 'sign_update'), ['--account', account, feed]);
    return { sha256: hash(feed) };
  });
  assert.equal(hash(feed), j.state.steps.feed.result.sha256);
  run(join(tools, 'sign_update'), ['--account', account, '--verify', feed]);
  boundary(root);
  const ready = { schema: 1, stage: 'signed-notarized-local-only', source: c.source, bundleID: 'com.jonslimak.omgskills',
    website, feedURL: updateFeed, account, publicKey: c.publicKey, teamID, versions, feed: { path: feed, sha256: hash(feed) },
    configurationSHA256: hash(join(root, 'configuration.json')), journalSHA256: hash(join(root, 'notarization-journal.json')),
    backupScope: c.backupScope, hosted: false, installed: false, launched: false, registered: false, vmChanged: false,
    limitations: ['VM acceptance and dedicated-site hosting remain unverified.', 'Never install or register this real-identity candidate on the host.'] };
  save(join(root, 'ready.json'), ready);
  return { receipt: join(root, 'ready.json'), stage: ready.stage };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { stage: { type: 'string' }, root: { type: 'string' },
      approved: { type: 'boolean', default: false } } });
    assert.equal(values.approved, true, 'Use --approved only after explicit candidate signing/Apple-upload approval');
    assert.ok(['prepare', 'notarize', 'finish'].includes(values.stage), 'Use --stage prepare, notarize or finish');
    const result = values.stage === 'prepare' ? prepareRelease({ approved: true })
      : values.stage === 'notarize' ? notarizeRelease(values.root, { approved: true }) : finishRelease(values.root);
    console.log(JSON.stringify(result ?? { stage: 'Apple accepted both candidates; finalization pending' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
