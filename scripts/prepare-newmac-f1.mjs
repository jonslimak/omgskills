#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export function loopbackURL(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a loopback HTTP URL with an explicit port.`); }
  if (typeof value !== 'string' || /[\s\\?#]/.test(value) || url.protocol !== 'http:'
      || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || Number(url.port) < 1 || url.username || url.password) {
    throw new Error(`${label} must be loopback HTTP with an explicit port and no credentials, query or fragment.`);
  }
  return url;
}

function connectedSettings(website, { catalogInstall = false, connectedInventoryTest = false,
  portalConnectURL, syncEndpoint, backendOrigin, testEnvironmentVerified = false,
  inventoryReconciliationTest = false } = {}) {
  if (typeof inventoryReconciliationTest !== 'boolean') {
    throw new Error('inventoryReconciliationTest must be a boolean.');
  }
  if (typeof connectedInventoryTest !== 'boolean' || typeof testEnvironmentVerified !== 'boolean') {
    throw new Error('Connected-test flags must be booleans.');
  }
  if (!connectedInventoryTest) {
    if (portalConnectURL !== undefined || syncEndpoint !== undefined || backendOrigin !== undefined
        || testEnvironmentVerified || inventoryReconciliationTest) {
      throw new Error('Connected inventory settings require explicit connectedInventoryTest opt-in.');
    }
    return {};
  }
  if (catalogInstall !== true || !testEnvironmentVerified) {
    throw new Error('Connected inventory requires catalogInstall and a verified test-environment assertion.');
  }
  const browser = loopbackURL(website, 'Website');
  const backend = loopbackURL(backendOrigin, 'Backend origin');
  const connect = loopbackURL(portalConnectURL, 'Portal connect URL');
  const sync = loopbackURL(syncEndpoint, 'Sync endpoint');
  if (browser.pathname !== '/app/' || backend.pathname !== '/' || backend.port === browser.port
      || connect.origin !== browser.origin || connect.pathname !== '/app/connect'
      || sync.origin !== backend.origin || sync.pathname !== '/api/portal/sync-upload') {
    throw new Error('Connected inventory requires /app/, distinct browser/backend ports and matching /app/connect and /api/portal/sync-upload endpoints.');
  }
  return { connectedInventoryTest: true, portalConnectURL: connect.href, syncEndpoint: sync.href,
    backendOrigin: backend.origin, testEnvironmentVerified: true,
    ...(inventoryReconciliationTest ? { inventoryReconciliationTest: true } : {}) };
}

export function validateInputs(binDirectory, website, options = {}) {
  const { catalogInstall = false } = options;
  if (typeof catalogInstall !== 'boolean') throw new Error('catalogInstall must be a boolean.');
  const connected = connectedSettings(website, options);
  const bin = realpathSync(binDirectory);
  if (basename(bin) !== 'debug' || !existsSync(join(bin, 'omgskills')) || !existsSync(join(bin, 'Sparkle.framework'))) {
    throw new Error('An existing SwiftPM Debug build with Sparkle is required.');
  }
  const url = new URL(website);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password) {
    throw new Error('A loopback HTTP website with an explicit port is required.');
  }
  return { bin, website: url.href, catalogInstall, ...connected };
}

export function bundleMetadata(config, root) {
  const connected = connectedSettings(config.website, config);
  let inventoryMetadata = {};
  if (connected.connectedInventoryTest) {
    if (typeof root !== 'string' || !/^\/private\/tmp\/omgskills-f1-[A-Za-z0-9-]+$/.test(root)
        || !statSync(root).isDirectory() || realpathSync(root) !== join(realpathSync('/private/tmp'), basename(root))
        || !statSync(join(root, 'home')).isDirectory() || realpathSync(join(root, 'home')) !== join(realpathSync(root), 'home')) {
      throw new Error('Connected inventory requires an existing, unredirected F1 root and isolated home.');
    }
    inventoryMetadata = {
      OMGSkillsConnectedInventoryTest: true,
      ...(connected.inventoryReconciliationTest ? { OMGSkillsInventoryReconciliationTest: true } : {}),
      OMGSkillsPortalConnectURL: connected.portalConnectURL,
      OMGSkillsSyncEndpoint: connected.syncEndpoint,
      OMGSkillsPortalSyncKeychainService: `com.jonslimak.omgskills.inventory-test.${basename(root).slice('omgskills-f1-'.length)}`,
    };
  }
  return {
    CFBundleIdentifier: 'com.jonslimak.omgskills.f1',
    CFBundleName: connected.connectedInventoryTest ? 'OMGSkills Connected Test' : 'OMGSkills F1 Test',
    CFBundleDisplayName: connected.connectedInventoryTest ? 'OMGSkills Connected Test' : 'OMGSkills F1 Test',
    CFBundleExecutable: 'omgskills-f1',
    CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.1', CFBundleVersion: '1',
    LSMinimumSystemVersion: '14.0', LSUIElement: true, LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'OMGSkills F1 Test', CFBundleURLSchemes: ['omgskills-f1'] }],
    OMGSkillsF1Root: root, OMGSkillsF1Website: config.website,
    OMGSkillsCatalogInstallEnabled: config.catalogInstall,
    ...inventoryMetadata,
  };
}

export function preparationReceipt(config, root, app, binarySHA256, createdAt = new Date().toISOString()) {
  const metadata = bundleMetadata(config, root);
  return { createdAt, root, app, website: config.website, binarySHA256,
    bundleID: metadata.CFBundleIdentifier, scheme: 'omgskills-f1', catalogInstall: config.catalogInstall,
    ...(metadata.OMGSkillsConnectedInventoryTest ? {
      connectedInventoryTest: true, testEnvironmentVerified: true,
      portalConnectURL: metadata.OMGSkillsPortalConnectURL, syncEndpoint: metadata.OMGSkillsSyncEndpoint,
      backendOrigin: config.backendOrigin, keychainService: metadata.OMGSkillsPortalSyncKeychainService,
      installerHome: join(root, 'home'), scannerHome: join(root, 'home'),
    } : {}),
    ...(metadata.OMGSkillsInventoryReconciliationTest ? { inventoryReconciliationTest: true } : {}),
    state: 'prepared and registered; not launched; no manual acceptance yet' };
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
  const receipt = preparationReceipt(config, root, app, createHash('sha256').update(readFileSync(binary)).digest('hex'));
  writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'bin-dir': { type: 'string' }, website: { type: 'string' },
    'catalog-install': { type: 'boolean', default: false }, 'connected-inventory-test': { type: 'boolean', default: false },
    'inventory-reconciliation-test': { type: 'boolean', default: false },
    'portal-connect-url': { type: 'string' }, 'sync-endpoint': { type: 'string' }, 'backend-origin': { type: 'string' },
    'test-environment-verified': { type: 'boolean', default: false } } });
  if (!values['bin-dir'] || !values.website) throw new Error('Use --bin-dir and --website.');
  console.log(JSON.stringify(prepare(values['bin-dir'], values.website, { catalogInstall: values['catalog-install'],
    connectedInventoryTest: values['connected-inventory-test'], portalConnectURL: values['portal-connect-url'],
    inventoryReconciliationTest: values['inventory-reconciliation-test'],
    syncEndpoint: values['sync-endpoint'], backendOrigin: values['backend-origin'],
    testEnvironmentVerified: values['test-environment-verified'] }), null, 2));
}
