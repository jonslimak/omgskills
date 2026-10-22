import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInputs, bundleMetadata, preparationReceipt } from './prepare-newmac-f1.mjs';

const website = 'http://127.0.0.1:5201/app/';
const connectedOptions = { catalogInstall: true, connectedInventoryTest: true, testEnvironmentVerified: true,
  portalConnectURL: 'http://127.0.0.1:5201/app/connect', syncEndpoint: 'http://127.0.0.1:8888/api/portal/sync-upload',
  backendOrigin: 'http://127.0.0.1:8888' };

test('automation is default-off and requires validated connected reconciliation metadata', t => {
  const { root, bin } = fixture(t);
  const baseline = validateInputs(bin, website, connectedOptions);
  assert.equal(bundleMetadata(baseline, root).OMGSkillsInventoryAutomationTest, undefined);
  assert.equal(preparationReceipt(baseline, root, '/fixture/app', 'hash').inventoryAutomationTest, undefined);
  const config = validateInputs(bin, website, { ...connectedOptions, inventoryReconciliationTest: true, inventoryAutomationTest: true });
  assert.equal(bundleMetadata(config, root).OMGSkillsInventoryAutomationTest, true);
  assert.equal(preparationReceipt(config, root, '/fixture/app', 'hash').inventoryAutomationTest, true);
  for (const change of [{ inventoryReconciliationTest: false }, { connectedInventoryTest: false },
    { inventoryAutomationTest: 'true' }, { testEnvironmentVerified: false }]) {
    assert.throws(() => validateInputs(bin, website, { ...config, ...change }));
  }
});

function fixture(t) {
  const root = mkdtempSync('/private/tmp/omgskills-f1-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'home'));
  const bin = join(root, 'debug');
  mkdirSync(join(bin, 'Sparkle.framework'), { recursive: true });
  writeFileSync(join(bin, 'omgskills'), 'fixture only; not executable');
  return { root, bin };
}

test('assembler refuses release builds and non-local websites', () => {
  const root = mkdtempSync(join(tmpdir(), 'f1-assembly-test-'));
  try {
    for (const mode of ['debug', 'release']) {
      mkdirSync(join(root, mode, 'Sparkle.framework'), { recursive: true });
      writeFileSync(join(root, mode, 'omgskills'), 'test');
    }
    assert.throws(() => validateInputs(join(root, 'release'), 'http://localhost:5197/'));
    for (const website of ['https://omgskills.com/app/', 'http://user@localhost:5197/', 'http://localhost/']) {
      assert.throws(() => validateInputs(join(root, 'debug'), website));
    }
    assert.equal(validateInputs(join(root, 'debug'), 'http://localhost:5197/').website, 'http://localhost:5197/');
  } finally { rmSync(root, { recursive: true }); }
});

test('test bundle has its own identity and contains no update feed', () => {
  const source = readFileSync(new URL('./prepare-newmac-f1.mjs', import.meta.url), 'utf8');
  assert.match(source, /com\.jonslimak\.omgskills\.f1/);
  assert.match(source, /CFBundleURLSchemes: \['omgskills-f1'\]/);
  assert.match(source, /join\(config\.bin, 'f1-apps', basename\(root\), 'OMGSkills F1 Test\.app'\)/);
  assert.match(source, /lsregister', \['-f', app\]/);
  assert.doesNotMatch(source, /SUFeedURL|SUPublicEDKey|\/Applications\/|release-mac\.sh/);
});

test('catalog flow is explicitly selected and does not change the test handler', () => {
  const config = { website: 'http://127.0.0.1:5197/app/', catalogInstall: false };
  const legacy = bundleMetadata(config, '/private/tmp/omgskills-f1-fixture');
  const catalog = bundleMetadata({ ...config, catalogInstall: true }, '/private/tmp/omgskills-f1-fixture');
  assert.equal(legacy.OMGSkillsCatalogInstallEnabled, false);
  assert.equal(catalog.OMGSkillsCatalogInstallEnabled, true);
  assert.deepEqual(catalog.CFBundleURLTypes, legacy.CFBundleURLTypes);
  assert.equal(catalog.CFBundleIdentifier, legacy.CFBundleIdentifier);
  assert.equal(catalog.OMGSkillsF1Root, '/private/tmp/omgskills-f1-fixture');
});

test('ordinary and catalog-only F1 defaults omit all connected metadata and receipt fields', t => {
  const { root, bin } = fixture(t);
  for (const options of [{}, { catalogInstall: true }]) {
    const config = validateInputs(bin, website, options);
    assert.deepEqual(config, { bin, website, catalogInstall: options.catalogInstall ?? false });
    const metadata = bundleMetadata(config, root);
    assert.equal(metadata.CFBundleDisplayName, 'OMGSkills F1 Test');
    for (const key of ['OMGSkillsConnectedInventoryTest', 'OMGSkillsPortalConnectURL', 'OMGSkillsSyncEndpoint',
      'OMGSkillsPortalSyncKeychainService']) assert.equal(Object.hasOwn(metadata, key), false);
    assert.deepEqual(preparationReceipt(config, root, '/fixture/app', 'fixture-hash', 'fixture-time'), {
      createdAt: 'fixture-time', root, app: '/fixture/app', website, binarySHA256: 'fixture-hash',
      bundleID: 'com.jonslimak.omgskills.f1', scheme: 'omgskills-f1', catalogInstall: options.catalogInstall ?? false,
      state: 'prepared and registered; not launched; no manual acceptance yet',
    });
  }
  // Existing ordinary website parsing is intentionally unchanged.
  assert.equal(validateInputs(bin, `${website}?legacy=1`).website, `${website}?legacy=1`);
});

test('connected metadata fixes F1 identity, local endpoints, unique service and one isolated home', t => {
  const first = fixture(t);
  const second = fixture(t);
  const config = validateInputs(first.bin, website, connectedOptions);
  const metadata = bundleMetadata(config, first.root);
  assert.equal(metadata.OMGSkillsConnectedInventoryTest, true);
  assert.equal(metadata.OMGSkillsCatalogInstallEnabled, true);
  assert.equal(metadata.CFBundleDisplayName, 'OMGSkills Connected Test');
  assert.equal(metadata.CFBundleIdentifier, 'com.jonslimak.omgskills.f1');
  assert.deepEqual(metadata.CFBundleURLTypes[0].CFBundleURLSchemes, ['omgskills-f1']);
  assert.equal(metadata.OMGSkillsF1Root, first.root);
  assert.equal(metadata.OMGSkillsF1Website, website);
  assert.equal(metadata.OMGSkillsPortalConnectURL, connectedOptions.portalConnectURL);
  assert.equal(metadata.OMGSkillsSyncEndpoint, connectedOptions.syncEndpoint);
  const service = metadata.OMGSkillsPortalSyncKeychainService;
  assert.equal(service, `com.jonslimak.omgskills.inventory-test.${first.root.split('omgskills-f1-')[1]}`);
  assert.match(service, /^com\.jonslimak\.omgskills\.inventory-test\.[A-Za-z0-9-]+$/);
  assert.notEqual(service, bundleMetadata(config, second.root).OMGSkillsPortalSyncKeychainService);
  assert.notEqual(first.root, second.root);
  const receipt = preparationReceipt(config, first.root, '/fixture/F1.app', 'fixture-hash');
  assert.equal(receipt.installerHome, join(first.root, 'home'));
  assert.equal(receipt.scannerHome, receipt.installerHome);
  assert.equal(receipt.keychainService, service);
});

test('connected settings reject missing opt-in, prerequisites and non-boolean flags', t => {
  const { bin } = fixture(t);
  for (const change of [
    { connectedInventoryTest: false }, { connectedInventoryTest: undefined }, { connectedInventoryTest: 'true' },
    { catalogInstall: false }, { catalogInstall: undefined }, { catalogInstall: 'true' },
    { testEnvironmentVerified: false }, { testEnvironmentVerified: undefined }, { testEnvironmentVerified: '1' },
    { portalConnectURL: undefined }, { syncEndpoint: undefined }, { backendOrigin: undefined },
  ]) assert.throws(() => validateInputs(bin, website, { ...connectedOptions, ...change }));
  for (const config of [{ portalConnectURL: connectedOptions.portalConnectURL },
    { syncEndpoint: connectedOptions.syncEndpoint }, { backendOrigin: connectedOptions.backendOrigin },
    { testEnvironmentVerified: true }, { connectedInventoryTest: 'false' }]) {
    assert.throws(() => validateInputs(bin, website, config));
  }
  assert.throws(() => validateInputs('/missing/debug', website, connectedOptions));
});

test('connected endpoints reject production, credentials, bad ports and browser/backend mismatches', t => {
  const { bin } = fixture(t);
  for (const change of [
    { portalConnectURL: 'http://localhost:5201/app/connect' },
    { portalConnectURL: 'http://127.0.0.1:5202/app/connect' },
    { portalConnectURL: 'http://127.0.0.1:5201/app/else' },
    { portalConnectURL: 'http://127.0.0.1:5201/app/connect/' },
    { portalConnectURL: 'http://127.0.0.1:5201/app/connect?' },
    { portalConnectURL: 'http://127.0.0.1:5201/app/connect#' },
    { syncEndpoint: 'http://localhost:8888/api/portal/sync-upload' },
    { syncEndpoint: 'http://127.0.0.1:8889/api/portal/sync-upload' },
    { syncEndpoint: 'http://127.0.0.1:8888/api/portal/sync-token' },
    { syncEndpoint: 'http://127.0.0.1:8888/api/portal/sync-upload?token=fixture' },
    { backendOrigin: 'http://127.0.0.1:8888/api/' },
    { backendOrigin: 'http://127.0.0.1:5201', syncEndpoint: 'http://127.0.0.1:5201/api/portal/sync-upload' },
  ]) assert.throws(() => validateInputs(bin, website, { ...connectedOptions, ...change }));
  for (const endpoint of ['https://omgskills.com', 'https://127.0.0.1:8888', 'http://192.168.1.2:8888',
    'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:invalid',
    'http://fixture:secret@127.0.0.1:8888', 'http://127.0.0.1:8888?token=fixture',
    'http://127.0.0.1:8888#fragment', ' http://127.0.0.1:8888', 'not-a-url']) {
    for (const field of ['backendOrigin', 'portalConnectURL', 'syncEndpoint']) {
      assert.throws(() => validateInputs(bin, website, { ...connectedOptions, [field]: endpoint }));
    }
    assert.throws(() => validateInputs(bin, endpoint, connectedOptions));
  }
});

test('replacement loopback port pair resolves consistently', t => {
  const { root, bin } = fixture(t);
  const config = validateInputs(bin, 'http://localhost:5301/app/', { ...connectedOptions,
    portalConnectURL: 'http://localhost:5301/app/connect', backendOrigin: 'http://localhost:8988/',
    syncEndpoint: 'http://localhost:8988/api/portal/sync-upload' });
  assert.equal(config.backendOrigin, 'http://localhost:8988');
  assert.equal(bundleMetadata(config, root).OMGSkillsPortalConnectURL, 'http://localhost:5301/app/connect');
});

test('connected assembler rejects website paths the native runtime cannot start', t => {
  const { root, bin } = fixture(t);
  for (const path of ['/', '/other/', '/app', '/app/preview/unified/']) {
    const invalidWebsite = new URL(path, website).href;
    assert.throws(() => validateInputs(bin, invalidWebsite, connectedOptions));
    assert.throws(() => bundleMetadata({ ...connectedOptions, website: invalidWebsite }, root));
  }
  assert.equal(validateInputs(bin, website, connectedOptions).website, website);
  assert.equal(validateInputs(bin, 'http://127.0.0.1:5201/').website, 'http://127.0.0.1:5201/');
});

test('connected metadata rejects missing, unsafe or redirected roots and homes', t => {
  const { root, bin } = fixture(t);
  const config = validateInputs(bin, website, connectedOptions);
  for (const invalid of ['/private/tmp/omgskills-f1-missing-fixture', '/Users/fixture', '/',
    `${root}/../${root.split('/').at(-1)}`, `${root}_unsafe`]) {
    assert.throws(() => bundleMetadata(config, invalid));
  }
  const redirected = `${root}-redirected`;
  symlinkSync(root, redirected);
  t.after(() => rmSync(redirected));
  assert.throws(() => bundleMetadata(config, redirected));
  rmSync(join(root, 'home'), { recursive: true });
  assert.throws(() => bundleMetadata(config, root));
  mkdirSync(join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(root, 'home'));
  assert.throws(() => bundleMetadata(config, root));
  assert.throws(() => bundleMetadata({ ...config, catalogInstall: false }, root));
});

test('receipt allowlist records resolved settings, never credentials or arbitrary input fields', t => {
  const { root, bin } = fixture(t);
  const config = validateInputs(bin, website, connectedOptions);
  const receipt = preparationReceipt({ ...config, token: 'fixture-secret', CLERK_SECRET_KEY: 'fixture-secret',
    environment: { password: 'fixture-secret' } }, root, '/fixture/F1.app', 'fixture-hash', 'fixture-time');
  assert.deepEqual(Object.keys(receipt).sort(), ['createdAt', 'root', 'app', 'website', 'binarySHA256',
    'bundleID', 'scheme', 'catalogInstall', 'connectedInventoryTest', 'testEnvironmentVerified',
    'portalConnectURL', 'syncEndpoint', 'backendOrigin', 'keychainService', 'installerHome', 'scannerHome', 'state'].sort());
  assert.equal(receipt.portalConnectURL, connectedOptions.portalConnectURL);
  assert.equal(receipt.syncEndpoint, connectedOptions.syncEndpoint);
  assert.equal(receipt.backendOrigin, connectedOptions.backendOrigin);
  assert.equal(receipt.connectedInventoryTest, true);
  assert.equal(receipt.testEnvironmentVerified, true);
  assert.equal(receipt.app, '/fixture/F1.app');
  assert.equal(receipt.scheme, 'omgskills-f1');
  assert.doesNotMatch(JSON.stringify(receipt), /fixture-secret|CLERK|password|token/);
});

test('missing or false reconciliation opt-in leaves ordinary, catalog and v2 configuration unchanged', t => {
  const { root, bin } = fixture(t);
  for (const options of [{}, { catalogInstall: true }, connectedOptions]) {
    const config = validateInputs(bin, website, options);
    const metadata = bundleMetadata(config, root);
    const receipt = preparationReceipt(config, root, '/fixture/F1.app', 'fixture-hash', 'fixture-time');
    assert.equal(Object.hasOwn(metadata, 'OMGSkillsInventoryReconciliationTest'), false);
    assert.equal(Object.hasOwn(receipt, 'inventoryReconciliationTest'), false);
    for (const inventoryReconciliationTest of [undefined, false]) {
      const unchanged = validateInputs(bin, website, { ...options, inventoryReconciliationTest });
      assert.deepEqual(unchanged, config);
      assert.deepEqual(bundleMetadata({ ...unchanged, inventoryReconciliationTest }, root), metadata);
      assert.deepEqual(preparationReceipt({ ...unchanged, inventoryReconciliationTest }, root,
        '/fixture/F1.app', 'fixture-hash', 'fixture-time'), receipt);
    }
  }
});

test('verified reconciliation opt-in adds only true mode metadata and receipt fields', t => {
  const { root, bin } = fixture(t);
  const v2 = validateInputs(bin, website, connectedOptions);
  const config = validateInputs(bin, website, { ...connectedOptions, inventoryReconciliationTest: true });
  assert.deepEqual(config, { ...v2, inventoryReconciliationTest: true });
  assert.deepEqual(bundleMetadata(config, root), { ...bundleMetadata(v2, root), OMGSkillsInventoryReconciliationTest: true });
  const receipt = preparationReceipt(config, root, '/fixture/F1.app', 'fixture-hash', 'fixture-time');
  assert.deepEqual(receipt, { ...preparationReceipt(v2, root, '/fixture/F1.app', 'fixture-hash', 'fixture-time'),
    inventoryReconciliationTest: true });
  assert.equal(receipt.scheme, 'omgskills-f1');
  assert.equal(receipt.installerHome, receipt.scannerHome);
});

test('reconciliation rejects malformed flags and missing or invalid connected prerequisites', t => {
  const { root, bin } = fixture(t);
  const checkRejected = options => {
    assert.throws(() => validateInputs(bin, website, options));
    assert.throws(() => bundleMetadata({ ...options, website }, root));
    assert.throws(() => preparationReceipt({ ...options, website }, root, '/fixture/F1.app', 'fixture-hash'));
  };
  for (const inventoryReconciliationTest of [null, 'true', 'false', 1, 0, [], {}]) {
    for (const options of [{}, connectedOptions]) checkRejected({ ...options, inventoryReconciliationTest });
  }
  checkRejected({ inventoryReconciliationTest: true });
  checkRejected({ catalogInstall: true, inventoryReconciliationTest: true });
  for (const changes of [
    { connectedInventoryTest: false }, { connectedInventoryTest: undefined },
    { catalogInstall: false }, { catalogInstall: undefined },
    { testEnvironmentVerified: false }, { testEnvironmentVerified: undefined },
    { portalConnectURL: undefined }, { syncEndpoint: undefined }, { backendOrigin: undefined },
    { portalConnectURL: 'https://omgskills.com/app/connect' },
    { syncEndpoint: 'http://127.0.0.1:8888/api/portal/sync-upload?token=fixture' },
  ]) checkRejected({ ...connectedOptions, inventoryReconciliationTest: true, ...changes });
  const config = validateInputs(bin, website, { ...connectedOptions, inventoryReconciliationTest: true });
  assert.throws(() => bundleMetadata(config, '/Users/fixture'));
});

test('CLI declares a Boolean reconciliation flag and forwards it without running preparation in tests', () => {
  const source = readFileSync(new URL('./prepare-newmac-f1.mjs', import.meta.url), 'utf8');
  assert.match(source, /'inventory-reconciliation-test': \{ type: 'boolean', default: false \}/);
  assert.match(source, /inventoryReconciliationTest: values\['inventory-reconciliation-test'\]/);
});
