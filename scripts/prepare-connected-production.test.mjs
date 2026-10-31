import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { metadata, recipe, release, website, updateFeed } from './prepare-connected-production.mjs';

const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64');

test('production packaging preserves identity with production-only account and manual update settings', () => {
  assert.deepEqual(release, { version: '0.0.29', build: '29' });
  const info = metadata(key);
  assert.equal(info.CFBundleIdentifier, 'com.jonslimak.omgskills');
  assert.equal(info.CFBundleDisplayName, 'OMGSkills');
  assert.equal(info.CFBundleShortVersionString, release.version);
  assert.equal(info.CFBundleVersion, release.build);
  assert.deepEqual(info.CFBundleURLTypes[0].CFBundleURLSchemes, ['omgskills']);
  assert.equal(info.OMGSkillsCatalogProductionWebsite, website);
  assert.equal(info.OMGSkillsConnectedProductionConnectURL, website + 'connect?inventory=3');
  assert.equal(info.OMGSkillsConnectedProductionUploadURL, 'https://omgskills.com/api/portal/sync-upload');
  assert.equal(info.OMGSkillsConnectedProductionCredentialService, 'com.jonslimak.omgskills.connected.inventory');
  assert.equal(info.SUFeedURL, updateFeed);
  assert.notEqual(info.SUFeedURL, 'https://omgskills.com/appcast.xml');
  assert.equal(info.SUPublicEDKey, key);
  assert.equal(info.OMGSkillsCatalogProductionUpdatePublicKey, key);
  for (const field of ['SUEnableAutomaticChecks', 'SUAutomaticallyUpdate', 'SUAllowsAutomaticUpdates',
    'SUEnableSystemProfiling']) assert.equal(info[field], false);
  assert.equal(info.OMGSkillsSkillGroupsAuthEnabled, true);
  assert.equal(info.SURequireSignedFeed, true);
  assert.equal(info.SUVerifyUpdateBeforeExtraction, true);
  assert.equal(info.LSMinimumSystemVersion, '14.0');
  assert.doesNotMatch(JSON.stringify(info), /netlify\.app|Candidate|Inspection|SetupTest|F1Root/);
});

test('production recipe isolates outputs and rejects mixed endpoints, automatic updates and metadata drift', () => {
  const value = recipe(key);
  value.validateMetadata(value.plist);
  assert.equal(value.outputDirectory, 'connected-production-packages');
  assert.equal(value.buildDirectory, '.build/connected-production/arm64-apple-macosx/release');
  assert.ok(value.buildArgs.includes('-DOMGSKILLS_CONNECTED_PRODUCTION'));
  assert.ok(!value.buildArgs.includes('-DOMGSKILLS_CONNECTED_CANDIDATE'));
  assert.ok(value.requiredSymbols.includes('ConnectedInventoryRuntime'));
  for (const change of [{ SUFeedURL: 'https://omgskills.com/appcast.xml' },
    { SUEnableAutomaticChecks: true }, { OMGSkillsConnectedCandidate: true }, { OMGSkillsSkillGroupsAuthEnabled: false },
    { OMGSkillsConnectedProductionConnectURL: 'https://other.invalid/' },
    { OMGSkillsConnectedProductionCredentialService: 'com.jonslimak.omgskills.catalog-candidate.inventory' }]) {
    assert.throws(() => value.validateMetadata({ ...value.plist, ...change }));
  }
  for (const invalid of [undefined, '', 'invalid', Buffer.alloc(32).toString('base64'),
    Buffer.alloc(32, 1).toString('base64'), key.slice(0, -1)]) assert.throws(() => metadata(invalid));
});

test('CLI requires unsigned-only and accepts no signing, output or feed override', () => {
  for (const args of [[], ['--unsigned-only', '--sign'], ['--unsigned-only', '--feed', updateFeed],
    ['--unsigned-only', '--output', '/tmp/override'], ['--unsigned-only', 'unexpected']]) {
    const result = spawnSync(process.execPath, [new URL('./prepare-connected-production.mjs', import.meta.url).pathname, ...args],
      { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /Building for production|local-pre-signing-inspection-only/);
  }
});
