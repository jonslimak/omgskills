import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { appName, metadata, validateMetadata, inspectionRecipe, prepareInspection,
  website, updateFeed, inspectionPublicKey } from './prepare-catalog-candidate.mjs';

const connected = { profile: 'connected' };
const connectedFields = {
  OMGSkillsConnectedCandidate: true,
  OMGSkillsConnectedCandidateConnectURL: 'https://omgskills-setup-test-f3b.netlify.app/app/connect',
  OMGSkillsConnectedCandidateUploadURL: 'https://omgskills-setup-test-f3b.netlify.app/api/portal/sync-upload',
  OMGSkillsConnectedCandidateCredentialService: 'com.jonslimak.omgskills.catalog-candidate.inventory',
};

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
  assert.deepEqual(metadata({ profile: 'install-only' }), info);
  assert.deepEqual(info, {
    CFBundleIdentifier: 'com.jonslimak.omgskills', CFBundleName: 'omgskills',
    CFBundleDisplayName: 'OMGSkills Candidate', CFBundleExecutable: 'omgskills', CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.0.0', CFBundleVersion: '1', CFBundleIconFile: 'omgskills.icns',
    LSMinimumSystemVersion: '14.0', LSUIElement: true, LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'com.jonslimak.omgskills.catalog-candidate', CFBundleURLSchemes: ['omgskills'] }],
    OMGSkillsCatalogCandidate: true, OMGSkillsCatalogCandidateWebsite: website,
    OMGSkillsCatalogCandidateUpdatePublicKey: inspectionPublicKey, OMGSkillsSkillGroupsAuthEnabled: false,
    SUFeedURL: updateFeed, SUPublicEDKey: inspectionPublicKey,
    SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false, SUAllowsAutomaticUpdates: false,
    SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true, SURequireSignedFeed: true,
    SUSignedFeedFailureExpirationInterval: 0,
  });
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
  assert.match(source, /return assemblePackage\(inspectionRecipe\(options\)\)/);
  const recipe = inspectionRecipe();
  assert.deepEqual(recipe.buildArgs, ['build', '--jobs', '2', '--scratch-path', '.build/catalog-candidate',
    '-c', 'release', '--arch', 'arm64', '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE']);
  assert.equal(recipe.buildDirectory, '.build/catalog-candidate/arm64-apple-macosx/release');
  assert.equal(recipe.outputDirectory, 'catalog-candidate-packages');
  assert.deepEqual(recipe.requiredSymbols, ['CatalogInstallWindowController', 'CatalogCandidateUpdater']);
  assert.deepEqual(recipe.forbiddenSymbols, ['PublicSkillInstallWindowController']);
  assert.deepEqual(recipe.plist, metadata());
  recipe.validateMetadata(recipe.plist);
  assert.equal(recipe.appName, 'omgskills.app');
  assert.equal(recipe.executable, 'omgskills');
  assert.deepEqual(recipe.sourceFiles, ['scripts/prepare-catalog-candidate.mjs',
    'scripts/prepare-catalog-candidate.test.mjs', 'menubar/Tests/omgskillsTests/CatalogCandidatePackageTests.swift']);
  assert.deepEqual(recipe.additionalLimitations, [
    'Synthetic 0.0.0/build 1 and inspection public key only. Do not sign or distribute this bundle.',
    'Rebuild with separately approved release metadata and candidate update key in checkpoint 3B.',
    'Uses the real product identity/storage. Do not launch, register or install on the host Mac.',
  ]);
  assert.doesNotMatch(source, /codesign|lsregister|notarytool|hdiutil|release-mac\.sh|rmSync|unlinkSync|\/usr\/bin\/open/);
});

test('connected metadata adds only the fixed isolated profile and synthetic inspection identity', () => {
  const info = metadata(connected);
  assert.deepEqual(info, { ...metadata(), CFBundleDisplayName: 'OMGSkills Connected Inspection',
    CFBundleVersion: '2', ...connectedFields });
  validateMetadata(info, connected);
  assert.throws(() => validateMetadata(info));
  assert.throws(() => validateMetadata(metadata(), connected));
});

test('connected validator rejects incomplete, redirected, mixed and distributable settings', () => {
  const info = metadata(connected);
  for (const key of Object.keys(info)) {
    const incomplete = { ...info }; delete incomplete[key];
    assert.throws(() => validateMetadata(incomplete, connected), key);
  }
  for (const change of [
    { OMGSkillsConnectedCandidate: 1 }, { OMGSkillsConnectedCandidate: false },
    { OMGSkillsConnectedCandidateConnectURL: website + 'connect?redirect=1' },
    { OMGSkillsConnectedCandidateUploadURL: 'https://omgskills.com/api/portal/sync-upload' },
    { OMGSkillsConnectedCandidateCredentialService: 'com.jonslimak.omgskills.portal-sync' },
    { OMGSkillsConnectedCandidateCredentialService: 'com.jonslimak.omgskills.inventory-test.old' },
    { OMGSkillsF1Root: '/private/tmp/old' }, { OMGSkillsSetupTestWebsite: website },
    { OMGSkillsConnectedInventoryTest: true },
    { OMGSkillsPortalSyncKeychainService: connectedFields.OMGSkillsConnectedCandidateCredentialService },
    { OMGSkillsSyncEndpoint: connectedFields.OMGSkillsConnectedCandidateUploadURL },
    { CFBundleIdentifier: 'other.app' }, { CFBundleVersion: '21' }, { CFBundleShortVersionString: '0.0.21' },
    { CFBundleDisplayName: 'OMGSkills Candidate' }, { SUEnableAutomaticChecks: true },
    { SUPublicEDKey: Buffer.alloc(32, 2).toString('base64') },
  ]) assert.throws(() => validateMetadata({ ...info, ...change }, connected), JSON.stringify(change));
});

test('connected recipe isolates outputs and enables both flags without changing shared assembly', () => {
  const base = inspectionRecipe();
  const recipe = inspectionRecipe(connected);
  assert.deepEqual(recipe.buildArgs, ['build', '--jobs', '2', '--scratch-path', '.build/connected-catalog-candidate-inspection',
    '-c', 'release', '--arch', 'arm64', '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE',
    '-Xswiftc', '-DOMGSKILLS_CONNECTED_CANDIDATE']);
  assert.equal(recipe.buildDirectory, '.build/connected-catalog-candidate-inspection/arm64-apple-macosx/release');
  assert.equal(recipe.outputDirectory, 'connected-catalog-candidate-packages');
  assert.notEqual(recipe.buildDirectory, base.buildDirectory);
  assert.notEqual(recipe.outputDirectory, base.outputDirectory);
  assert.deepEqual(recipe.requiredSymbols, [...base.requiredSymbols, 'ConnectedInventoryRuntime']);
  for (const key of ['sourceFiles', 'forbiddenSymbols', 'appName', 'executable']) assert.deepEqual(recipe[key], base[key]);
  recipe.validateMetadata(recipe.plist);
  assert.throws(() => recipe.validateMetadata(base.plist));
  assert.throws(() => base.validateMetadata(recipe.plist));
  assert.match(recipe.additionalLimitations[0], /Synthetic 0\.0\.0\/build 2/);
  assert.deepEqual(recipe.additionalLimitations.slice(1), base.additionalLimitations.slice(1));
});

test('all helpers reject unsupported options before assembly or output writes', () => {
  for (const options of [null, [], 'connected', Object.create({ profile: 'connected' }),
    { profile: '' }, { profile: null }, { profile: 'production' }, { profile: 'CONNECTED' },
    { profile: 'connected', outputDirectory: '/private/tmp/override' },
    { profile: 'connected', publicKey: inspectionPublicKey }, { profile: 'install-only', connectURL: website },
    { [Symbol('override')]: true }]) {
    for (const action of [metadata, inspectionRecipe, prepareInspection]) assert.throws(() => action(options));
    assert.throws(() => validateMetadata(metadata(), options));
  }
});

test('recipe validation captures the chosen profile and returned values are independent', () => {
  const options = { profile: 'connected' };
  const recipe = inspectionRecipe(options);
  options.profile = 'install-only';
  recipe.validateMetadata(metadata(connected));
  recipe.plist.CFBundleURLTypes[0].CFBundleURLSchemes.push('other');
  recipe.buildArgs.push('-DOTHER'); recipe.requiredSymbols.length = 0;
  assert.throws(() => recipe.validateMetadata(recipe.plist));
  assert.deepEqual(inspectionRecipe(connected).plist, metadata(connected));
  assert.equal(inspectionRecipe().buildArgs.includes('-DOTHER'), false);
  assert.equal(inspectionRecipe(connected).requiredSymbols.includes('ConnectedInventoryRuntime'), true);
});

test('environment cannot opt into connection or redirect the pure inspection recipe', () => {
  const url = new URL('./prepare-catalog-candidate.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { inspectionRecipe } from ${JSON.stringify(url)}; console.log(JSON.stringify(inspectionRecipe()));`], {
    encoding: 'utf8', timeout: 10000,
    env: { OMGSKILLS_CONNECTED_CANDIDATE: '1', OMGSkillsConnectedCandidate: 'true',
      OMGSkillsSyncEndpoint: 'https://other.invalid/', HOME: '/private/tmp/unused-cc3a-home' },
  });
  assert.equal(result.status, 0, result.stderr);
  const recipe = JSON.parse(result.stdout);
  assert.deepEqual(recipe.plist, metadata());
  assert.equal(recipe.outputDirectory, 'catalog-candidate-packages');
});

test('CLI requires explicit inspection scope and refuses distribution inputs before building', () => {
  for (const args of [[], ['--public-key', inspectionPublicKey], ['--inspection-only', '--version', '0.0.21'],
    ['--profile', 'connected'], ['--inspection-only', '--profile', 'production'],
    ['--inspection-only', '--profile', ''], ['--inspection-only', '--profile', 'connected', '--version', '0.0.22'],
    ['--inspection-only', '--profile', 'connected', '--output-directory', '/private/tmp/override'],
    ['--inspection-only', '--profile', 'connected', 'unexpected']]) {
    const result = spawnSync(process.execPath, [new URL('./prepare-catalog-candidate.mjs', import.meta.url).pathname, ...args],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /Building for production|local-pre-signing-inspection-only/);
  }
});
