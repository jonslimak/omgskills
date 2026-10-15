import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { appName, metadata, validateMetadata, website, updateFeed, inspectionPublicKey } from './prepare-catalog-candidate.mjs';

test('inspection uses product identity/storage contract and only the fixed candidate channel', () => {
  const info = metadata(); validateMetadata(info);
  assert.equal(appName, 'omgskills.app');
  assert.equal(info.CFBundleIdentifier, 'com.jonslimak.omgskills');
  assert.equal(info.CFBundleExecutable, 'omgskills');
  assert.deepEqual(info.CFBundleURLTypes[0].CFBundleURLSchemes, ['omgskills']);
  assert.equal(info.OMGSkillsCatalogCandidateWebsite, website);
  assert.equal(info.SUFeedURL, updateFeed);
  assert.equal(info.CFBundleShortVersionString, '0.0.0'); assert.equal(info.CFBundleVersion, '1');
  assert.equal(info.SUPublicEDKey, inspectionPublicKey);
  for (const key of ['SUEnableAutomaticChecks', 'SUAutomaticallyUpdate', 'SUAllowsAutomaticUpdates', 'SUEnableSystemProfiling', 'OMGSkillsSkillGroupsAuthEnabled']) assert.equal(info[key], false);
  assert.equal(info.SURequireSignedFeed, true); assert.equal(info.SUVerifyUpdateBeforeExtraction, true);
  assert.equal(info.SUSignedFeedFailureExpirationInterval, 0);
});

test('incomplete, mixed, distribution and redirected settings cannot pass inspection', () => {
  for (const key of Object.keys(metadata())) {
    const info = metadata(); delete info[key]; assert.throws(() => validateMetadata(info));
  }
  for (const change of [{ CFBundleIdentifier: 'com.jonslimak.omgskills.setuptest' },
    { CFBundleExecutable: 'omgskills-setup-test' }, { CFBundleShortVersionString: '0.0.21' },
    { CFBundleVersion: '21' }, { OMGSkillsCatalogCandidate: false }, { OMGSkillsF1Root: '/private/tmp/old' },
    { OMGSkillsSetupTestWebsite: website }, { OMGSkillsCatalogCandidateWebsite: 'https://omgskills.com/app/' },
    { SUFeedURL: 'https://omgskills.com/appcast.xml' }, { SUEnableAutomaticChecks: true },
    { SUAutomaticallyUpdate: true }, { SURequireSignedFeed: false }, { SUPublicEDKey: 'other-key' },
    { CFBundleURLTypes: [{ CFBundleURLSchemes: ['omgskills', 'omgskills-f1'] }] }, { HOME: '/Users/example' }]) {
    assert.throws(() => validateMetadata({ ...metadata(), ...change }));
  }
});

test('candidate assembler reuses shared inspection without activating or releasing the app', () => {
  const source = readFileSync(new URL('./prepare-catalog-candidate.mjs', import.meta.url), 'utf8');
  assert.match(source, /assemblePackage/);
  assert.match(source, /-DOMGSKILLS_CATALOG_CANDIDATE/);
  assert.match(source, /requiredSymbols: \['CatalogInstallWindowController', 'CatalogCandidateUpdater'\]/);
  assert.match(source, /forbiddenSymbols: \['PublicSkillInstallWindowController'\]/);
  assert.doesNotMatch(source, /codesign|lsregister|notarytool|hdiutil|release-mac\.sh|rmSync|unlinkSync|\/usr\/bin\/open/);
});

test('CLI requires explicit inspection scope and refuses distribution inputs before building', () => {
  for (const args of [[], ['--public-key', inspectionPublicKey], ['--inspection-only', '--version', '0.0.21']]) {
    const result = spawnSync(process.execPath, [new URL('./prepare-catalog-candidate.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /Building for production|local-pre-signing-inspection-only/);
  }
});
