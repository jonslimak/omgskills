import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseMetadata, validateReleaseMetadata, releases, archiveName, renderFeed, prepareRelease, notarizeRelease, exportPrivateBackup } from './release-catalog-candidate.mjs';
import { metadata, validateMetadata, inspectionPublicKey, website, updateFeed } from './prepare-catalog-candidate.mjs';

const key = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const candidateKey = key(), productionKey = key();

test('private backup export uses a new path, locks permissions and never overwrites', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'candidate-backup-test-')));
  try {
    const path = join(directory, 'fixture.txt');
    exportPrivateBackup('fixture-tool', path, (tool, args) => {
      assert.equal(tool, 'fixture-tool'); assert.equal(args.at(-1), path);
      assert.equal(existsSync(path), false, 'Sparkle refuses pre-created destinations');
      writeFileSync(path, 'synthetic fixture', { flag: 'wx', mode: 0o644 });
    });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => exportPrivateBackup('fixture-tool', path, () => assert.fail('Must not overwrite')));
    const failed = join(directory, 'partial.txt');
    assert.throws(() => exportPrivateBackup('fixture-tool', failed, () => {
      writeFileSync(failed, 'partial fixture', { mode: 0o644 }); throw Error('fixture failure');
    }), /fixture failure/);
    assert.equal(statSync(failed).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true }); }
});

test('real candidate metadata changes only approved versions and separate update keys', () => {
  for (const [release, [version, build]] of Object.entries(releases)) {
    const value = releaseMetadata(release, candidateKey, productionKey);
    validateReleaseMetadata(value, release, candidateKey, productionKey);
    const expected = { ...metadata(), CFBundleShortVersionString: version, CFBundleVersion: build,
      SUPublicEDKey: candidateKey, OMGSkillsCatalogCandidateUpdatePublicKey: candidateKey };
    assert.deepEqual(value, expected);
    assert.equal(value.OMGSkillsCatalogCandidateWebsite, website);
    assert.equal(value.SUFeedURL, updateFeed);
    assert.throws(() => validateMetadata(value), 'Inspection scope must stay separate');
  }
});

test('rejects missing, synthetic, noncanonical, production and unapproved release inputs', () => {
  for (const k of [undefined, '', 'invalid', inspectionPublicKey, Buffer.alloc(32).toString('base64'),
    Buffer.alloc(32, 2).toString('base64'), candidateKey + '\n', productionKey]) {
    assert.throws(() => releaseMetadata('a', k, productionKey));
  }
  for (const release of ['latest', 'constructor', '../b', '', undefined]) assert.throws(() => releaseMetadata(release, candidateKey, productionKey));
  assert.throws(() => releaseMetadata('a', candidateKey, undefined));
  assert.throws(() => validateReleaseMetadata(metadata(), 'a', candidateKey, productionKey));
});

test('release metadata refuses cross-channel settings, changed policy and A/B mixups', () => {
  const good = releaseMetadata('a', candidateKey, productionKey);
  for (const changes of [{ CFBundleIdentifier: 'com.jonslimak.omgskills.setuptest' },
    { CFBundleVersion: '22' }, { CFBundleShortVersionString: '0.0.22' }, { SUPublicEDKey: key() },
    { SUFeedURL: 'https://omgskills.com/appcast.xml' }, { OMGSkillsCatalogCandidateWebsite: 'https://omgskills.com/app/' },
    { SUEnableAutomaticChecks: true }, { SURequireSignedFeed: false }, { SUDefaultsDomain: 'com.jonslimak.omgskills' },
    { OMGSkillsF1Root: '/tmp/test' }, { OMGSkillsSetupTestWebsite: website }]) {
    assert.throws(() => validateReleaseMetadata({ ...good, ...changes }, 'a', candidateKey, productionKey));
  }
  for (const name of Object.keys(good)) {
    const value = { ...good }; delete value[name];
    assert.throws(() => validateReleaseMetadata(value, 'a', candidateKey, productionKey));
  }
});

const versions = () => Object.entries(releases).map(([release, [version, build]]) => ({ release, version, build,
  archive: `/tmp/${archiveName(release)}`, bytes: 12345, edSignature: Buffer.alloc(64, 1).toString('base64') }));

test('feed has fixed candidate-only full archive URLs, exact A/B versions and no deltas', () => {
  const feed = renderFeed(versions());
  assert.equal((feed.match(/<item>/g) ?? []).length, 2);
  assert.equal((feed.match(/sparkle:installationType="application"/g) ?? []).length, 2);
  assert.ok(feed.indexOf('<title>0.0.22</title>') < feed.indexOf('<title>0.0.21</title>'));
  for (const release of Object.keys(releases)) assert.ok(feed.includes(new URL(archiveName(release), updateFeed).href));
  assert.doesNotMatch(feed, /omgskills\.com|deltas|\.dmg|\.setuptest|DOCTYPE/);
});

test('feed refuses duplicate/missing builds, foreign filenames and malformed metadata', () => {
  assert.throws(() => renderFeed(versions().slice(0, 1)));
  assert.throws(() => renderFeed([versions()[0], versions()[0]]));
  for (const change of [{ build: '99' }, { version: '0.0.99' }, { release: 'latest' },
    { archive: '/tmp/other.zip' }, { bytes: 0 }, { bytes: '12345' }, { bytes: 1.5 },
    { edSignature: 'bad' }, { edSignature: Buffer.alloc(64, 1).toString('base64') + '\n' }]) {
    const values = versions(); values[0] = { ...values[0], ...change };
    assert.throws(() => renderFeed(values));
  }
});

test('signing and uploading require explicit approval before any side effect', () => {
  assert.throws(() => prepareRelease(), /approval/);
  assert.throws(() => notarizeRelease('/tmp/anything'), /approval/);
  for (const args of [[], ['--stage', 'prepare'], ['--stage', 'notarize', '--root', '/tmp/anything'],
    ['--approved', '--stage', 'host'], ['--approved', '--stage', 'finish', '--root', '/tmp/not-a-candidate']]) {
    const result = spawnSync(process.execPath, [new URL('./release-catalog-candidate.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Candidate output:|Signed and verified|Apple accepted/);
  }
});

test('release workflow reuses known signing/journal checks and has no hosting, registration or installation commands', () => {
  const source = readFileSync(new URL('./release-catalog-candidate.mjs', import.meta.url), 'utf8');
  for (const part of ['assemblePackage', 'FinalizationJournal', 'verifyEntitlements', 'parseSignature',
    'unsignedExecutableHash', 'archiveRoundtripVerified', 'backup-verification.bin', 'privateBackupSHA256']) assert.ok(source.includes(part));
  assert.doesNotMatch(source, /lsregister|hdiutil|netlify deploy|release-mac\.sh|\/usr\/bin\/open|\/Applications\/omgskills/);
  assert.match(source, /hosted: false, installed: false, launched: false, registered: false/);
});
