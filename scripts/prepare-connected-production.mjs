#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectionRecipe } from './prepare-catalog-candidate.mjs';
import { assemblePackage } from './prepare-newmac-setup-test.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const release = Object.freeze({ version: '0.0.26', build: '26' });
export const website = 'https://omgskills.com/app/';
export const updateFeed = 'https://omgskills.com/updates/connected/appcast.xml';

export function metadata(publicKey) {
  assert.equal(typeof publicKey, 'string', 'Existing production public update key required');
  const bytes = Buffer.from(publicKey, 'base64');
  assert.ok(bytes.length === 32 && new Set(bytes).size > 1 && bytes.toString('base64') === publicKey,
    'Use the canonical, non-synthetic production public key');
  const value = inspectionRecipe({ profile: 'connected' }).plist;
  for (const key of Object.keys(value)) {
    if (key.startsWith('OMGSkillsCatalogCandidate') || key.startsWith('OMGSkillsConnectedCandidate')) delete value[key];
  }
  return { ...value,
    CFBundleDisplayName: 'OMGSkills',
    CFBundleShortVersionString: release.version, CFBundleVersion: release.build,
    CFBundleURLTypes: [{ CFBundleURLName: 'com.jonslimak.omgskills.portal-pairing', CFBundleURLSchemes: ['omgskills'] }],
    OMGSkillsCatalogProduction: true, OMGSkillsCatalogProductionWebsite: website,
    OMGSkillsCatalogProductionUpdatePublicKey: publicKey,
    OMGSkillsConnectedProduction: true,
    OMGSkillsConnectedProductionConnectURL: website + 'connect?inventory=3',
    OMGSkillsConnectedProductionUploadURL: 'https://omgskills.com/api/portal/sync-upload',
    OMGSkillsConnectedProductionCredentialService: 'com.jonslimak.omgskills.connected.inventory',
    SUFeedURL: updateFeed, SUPublicEDKey: publicKey,
  };
}

export function recipe(publicKey) {
  const base = inspectionRecipe({ profile: 'connected' });
  const scratch = '.build/connected-production';
  return { ...base, plist: metadata(publicKey),
    validateMetadata: value => assert.deepEqual(value, metadata(publicKey), 'Unexpected production package settings'),
    buildArgs: ['build', '--jobs', '2', '--scratch-path', scratch, '-c', 'release', '--arch', 'arm64',
      '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_CATALOG_CANDIDATE',
      '-Xswiftc', '-DOMGSKILLS_CONNECTED_PRODUCTION'],
    buildDirectory: scratch + '/arm64-apple-macosx/release', outputDirectory: 'connected-production-packages',
    sourceFiles: [...base.sourceFiles, 'scripts/prepare-connected-production.mjs',
      'scripts/prepare-connected-production.test.mjs', 'menubar/Info.plist',
      'menubar/Tests/omgskillsTests/ProductionConnectedConfigurationTests.swift'],
    additionalLimitations: [
      'Production 0.0.26 (26), Apple silicon, macOS 14+. Unsigned and not distributable.',
      'Preparation preserves the existing production account/inventory activation; no gate changes.',
      'Separate opt-in connected update channel; existing public appcast and downloads are unchanged.',
      'Existing production public update key only; no private keys or signing in this stage.',
      'Uses real product identity/storage. Do not launch, register or install on the host Mac.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'unsigned-only': { type: 'boolean', default: false } } });
  assert.equal(values['unsigned-only'], true, 'Use --unsigned-only; signing and distribution are separate');
  const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-',
    join(repository, 'menubar/Info.plist')], { encoding: 'utf8' }));
  console.log(JSON.stringify(assemblePackage(recipe(info.SUPublicEDKey)), null, 2));
}
