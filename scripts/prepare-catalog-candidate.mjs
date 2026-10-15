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

export function metadata() {
  return {
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
  };
}

export function validateMetadata(value) {
  assert.deepEqual(value, metadata(), 'Unexpected inspection-only candidate metadata');
}

export function prepareInspection() {
  return assemblePackage({ plist: metadata(), appName, executable: 'omgskills', validateMetadata,
    buildArgs: ['build', '--jobs', '2', '--scratch-path', '.build/catalog-candidate', '-c', 'release', '--arch', 'arm64',
      '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE'],
    buildDirectory: '.build/catalog-candidate/arm64-apple-macosx/release', outputDirectory: 'catalog-candidate-packages',
    requiredSymbols: ['CatalogInstallWindowController', 'CatalogCandidateUpdater'],
    forbiddenSymbols: ['PublicSkillInstallWindowController'],
    sourceFiles: ['scripts/prepare-catalog-candidate.mjs', 'scripts/prepare-catalog-candidate.test.mjs',
      'menubar/Tests/omgskillsTests/CatalogCandidatePackageTests.swift'],
    additionalLimitations: ['Synthetic 0.0.0/build 1 and inspection public key only. Do not sign or distribute this bundle.',
      'Rebuild with separately approved release metadata and candidate update key in checkpoint 3B.',
      'Uses the real product identity/storage. Do not launch, register or install on the host Mac.'],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'inspection-only': { type: 'boolean', default: false } } });
  assert.equal(values['inspection-only'], true, 'Use --inspection-only; this command cannot prepare a distributable release');
  console.log(JSON.stringify(prepareInspection(), null, 2));
}
