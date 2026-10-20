#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assemblePackage } from './prepare-newmac-setup-test.mjs';

export const appName = 'omgskills.app';
export const website = 'https://omgskills-setup-test-f3b.netlify.app/app/';
export const updateFeed = 'https://omgskills-setup-test-f3b.netlify.app/updates/catalog-candidate/appcast.xml';
// Inspection only: no corresponding private key or distribution version is created.
export const inspectionPublicKey = Buffer.alloc(32, 1).toString('base64');

function inspectionProfile(options) {
  assert.ok(options !== null && typeof options === 'object' && Object.getPrototypeOf(options) === Object.prototype,
    'Expected inspection options');
  assert.ok(Reflect.ownKeys(options).every(key => key === 'profile'), 'Unexpected inspection configuration');
  const profile = options.profile === undefined ? 'install-only' : options.profile;
  assert.ok(['install-only', 'connected'].includes(profile), 'Unknown inspection profile');
  return profile;
}

export function metadata(options = {}) {
  const connected = inspectionProfile(options) === 'connected';
  return {
    CFBundleIdentifier: 'com.jonslimak.omgskills', CFBundleName: 'omgskills',
    CFBundleDisplayName: connected ? 'OMGSkills Connected Inspection' : 'OMGSkills Candidate',
    CFBundleExecutable: 'omgskills', CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.0.0', CFBundleVersion: connected ? '2' : '1', CFBundleIconFile: 'omgskills.icns',
    LSMinimumSystemVersion: '14.0', LSUIElement: true, LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'com.jonslimak.omgskills.catalog-candidate', CFBundleURLSchemes: ['omgskills'] }],
    OMGSkillsCatalogCandidate: true, OMGSkillsCatalogCandidateWebsite: website,
    OMGSkillsCatalogCandidateUpdatePublicKey: inspectionPublicKey, OMGSkillsSkillGroupsAuthEnabled: false,
    SUFeedURL: updateFeed, SUPublicEDKey: inspectionPublicKey,
    SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false, SUAllowsAutomaticUpdates: false,
    SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true, SURequireSignedFeed: true,
    SUSignedFeedFailureExpirationInterval: 0,
    ...(connected ? {
      OMGSkillsConnectedCandidate: true,
      OMGSkillsConnectedCandidateConnectURL: website + 'connect',
      OMGSkillsConnectedCandidateUploadURL: 'https://omgskills-setup-test-f3b.netlify.app/api/portal/sync-upload',
      OMGSkillsConnectedCandidateCredentialService: 'com.jonslimak.omgskills.catalog-candidate.inventory',
    } : {}),
  };
}

export function validateMetadata(value, options = {}) {
  assert.deepEqual(value, metadata(options), 'Unexpected inspection-only candidate metadata');
}

export function inspectionRecipe(options = {}) {
  const profile = inspectionProfile(options);
  const connected = profile === 'connected';
  const scratch = connected ? '.build/connected-catalog-candidate-inspection' : '.build/catalog-candidate';
  return { plist: metadata({ profile }), appName, executable: 'omgskills',
    validateMetadata: value => validateMetadata(value, { profile }),
    buildArgs: ['build', '--jobs', '2', '--scratch-path', scratch, '-c', 'release', '--arch', 'arm64',
      '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE',
      ...(connected ? ['-Xswiftc', '-DOMGSKILLS_CONNECTED_CANDIDATE'] : [])],
    buildDirectory: scratch + '/arm64-apple-macosx/release',
    outputDirectory: connected ? 'connected-catalog-candidate-packages' : 'catalog-candidate-packages',
    requiredSymbols: ['CatalogInstallWindowController', 'CatalogCandidateUpdater',
      ...(connected ? ['ConnectedInventoryRuntime'] : [])],
    forbiddenSymbols: ['PublicSkillInstallWindowController'],
    sourceFiles: ['scripts/prepare-catalog-candidate.mjs', 'scripts/prepare-catalog-candidate.test.mjs',
      'menubar/Tests/omgskillsTests/CatalogCandidatePackageTests.swift'],
    additionalLimitations: [`Synthetic 0.0.0/build ${connected ? '2' : '1'} and inspection public key only. Do not sign or distribute this bundle.`,
      'Rebuild with separately approved release metadata and candidate update key in checkpoint 3B.',
      'Uses the real product identity/storage. Do not launch, register or install on the host Mac.'],
  };
}

export function prepareInspection(options = {}) {
  return assemblePackage(inspectionRecipe(options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'inspection-only': { type: 'boolean', default: false }, profile: { type: 'string' },
  } });
  assert.equal(values['inspection-only'], true, 'Use --inspection-only; this command cannot prepare a distributable release');
  console.log(JSON.stringify(prepareInspection({ profile: values.profile }), null, 2));
}
