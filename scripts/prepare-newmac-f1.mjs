#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export function validateInputs(binDirectory, website, { catalogInstall = false } = {}) {
  if (typeof catalogInstall !== 'boolean') throw new Error('catalogInstall must be a boolean.');
  const bin = realpathSync(binDirectory);
  if (basename(bin) !== 'debug' || !existsSync(join(bin, 'omgskills')) || !existsSync(join(bin, 'Sparkle.framework'))) {
    throw new Error('An existing SwiftPM Debug build with Sparkle is required.');
  }
  const url = new URL(website);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password) {
    throw new Error('A loopback HTTP website with an explicit port is required.');
  }
  return { bin, website: url.href, catalogInstall };
}

export function bundleMetadata(config, root) {
  return {
    CFBundleIdentifier: 'com.jonslimak.omgskills.f1', CFBundleName: 'OMGSkills F1 Test',
    CFBundleDisplayName: 'OMGSkills F1 Test', CFBundleExecutable: 'omgskills-f1',
    CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.1', CFBundleVersion: '1',
    LSMinimumSystemVersion: '14.0', LSUIElement: true, LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'OMGSkills F1 Test', CFBundleURLSchemes: ['omgskills-f1'] }],
    OMGSkillsF1Root: root, OMGSkillsF1Website: config.website,
    OMGSkillsCatalogInstallEnabled: config.catalogInstall,
  };
}

export function prepare(binDirectory, website, options = {}) {
  const config = validateInputs(binDirectory, website, options);
  const root = mkdtempSync('/private/tmp/omgskills-f1-');
  // LaunchServices excludes temporary-directory apps from URL handler selection.
  const app = join(config.bin, 'f1-apps', basename(root), 'OMGSkills F1 Test.app');
  const contents = join(app, 'Contents');
  for (const name of ['MacOS', 'Resources', 'Frameworks']) mkdirSync(join(contents, name), { recursive: true });
  mkdirSync(join(root, 'home'));
  const binary = join(contents, 'MacOS/omgskills-f1');
  cpSync(join(config.bin, 'omgskills'), binary);
  for (const name of readdirSync(config.bin)) {
    if (name.endsWith('.framework')) execFileSync('/usr/bin/ditto', [join(config.bin, name), join(contents, 'Frameworks', name)]);
    if (name.endsWith('.bundle') && !name.includes('Tests')) cpSync(join(config.bin, name), join(contents, 'Resources', name), { recursive: true });
  }
  const metadata = bundleMetadata(config, root);
  const plist = join(contents, 'Info.plist');
  writeFileSync(plist, JSON.stringify(metadata));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
  const loadCommands = execFileSync('/usr/bin/otool', ['-l', binary], { encoding: 'utf8' });
  if (!loadCommands.includes('@executable_path/../Frameworks')) {
    execFileSync('/usr/bin/install_name_tool', ['-add_rpath', '@executable_path/../Frameworks', binary]);
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
  const receipt = { createdAt: new Date().toISOString(), root, app, website: config.website,
    binarySHA256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    bundleID: metadata.CFBundleIdentifier, scheme: 'omgskills-f1', catalogInstall: config.catalogInstall,
    state: 'prepared and registered; not launched; no manual acceptance yet' };
  writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'bin-dir': { type: 'string' }, website: { type: 'string' }, 'catalog-install': { type: 'boolean', default: false } } });
  if (!values['bin-dir'] || !values.website) throw new Error('Use --bin-dir and --website.');
  console.log(JSON.stringify(prepare(values['bin-dir'], values.website, { catalogInstall: values['catalog-install'] }), null, 2));
}
