import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inventoryTestPlan, inventoryTestCommand } from './prepare-newmac-inventory-test.mjs';

function fixture(t) {
  const root = mkdtempSync('/private/tmp/inventory-plan-fixture-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binDirectory = join(root, 'debug');
  mkdirSync(join(binDirectory, 'Sparkle.framework'), { recursive: true });
  writeFileSync(join(binDirectory, 'omgskills'), 'fixture only; not executable');
  return { binDirectory, website: 'http://127.0.0.1:5201/app/', backendOrigin: 'http://127.0.0.1:8888',
    testEnvironmentVerified: true };
}

test('automation plans carry both gates and require reconciliation without preparing an app', t => {
  const input = fixture(t);
  const plan = inventoryTestPlan({ ...input, inventoryReconciliationTest: true, inventoryAutomationTest: true });
  assert.equal(plan.options.inventoryAutomationTest, true);
  assert.equal(plan.options.inventoryReconciliationTest, true);
  assert.equal(plan.backendEnvironment.OMGSKILLS_INVENTORY_RECONCILIATION_TEST, '1');
  assert.equal(plan.browserEnvironment.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST, '1');
  const args = ['--bin-dir', input.binDirectory, '--website', input.website, '--backend-origin', input.backendOrigin,
    '--test-environment-verified', '--inventory-reconciliation-test', '--inventory-automation-test'];
  assert.equal(inventoryTestCommand(args).plan.options.inventoryAutomationTest, true);
  assert.equal(inventoryTestCommand(args).prepareRequested, false);
  assert.throws(() => inventoryTestPlan({ ...input, inventoryAutomationTest: true }));
  assert.throws(() => inventoryTestPlan({ ...input, inventoryReconciliationTest: true, inventoryAutomationTest: 'true' }));
  assert.throws(() => inventoryTestPlan({ ...input, inventoryReconciliationTest: true,
    backendEnvironment: { OMGSKILLS_INVENTORY_RECONCILIATION_TEST: '0' } }));
});

test('plan derives coherent native/browser/backend configuration without preparing anything', t => {
  const input = fixture(t);
  const before = readdirSync(input.binDirectory, { recursive: true });
  const plan = inventoryTestPlan(input);
  assert.equal(plan.binDirectory, input.binDirectory);
  assert.equal(plan.website, input.website);
  assert.deepEqual(plan.options, { catalogInstall: true, connectedInventoryTest: true,
    testEnvironmentVerified: true, backendOrigin: input.backendOrigin,
    portalConnectURL: 'http://127.0.0.1:5201/app/connect', syncEndpoint: 'http://127.0.0.1:8888/api/portal/sync-upload' });
  assert.deepEqual(plan.browserEnvironment, { VITE_PORTAL_INTEGRATION: '1',
    PORTAL_TEST_API_ORIGIN: input.backendOrigin, PORTAL_TEST_ENVIRONMENT_VERIFIED: '1',
    VITE_SKILLGROUPS_WEB_ENABLED: '1', VITE_NEWMAC_CATALOG_INSTALL_TEST: '1', VITE_NEWMAC_CONNECTED_INVENTORY_TEST: '1' });
  assert.deepEqual(plan.backendEnvironment, { CONTEXT: 'dev', NODE_ENV: 'development',
    OMGSKILLS_CONNECTED_INVENTORY_TEST: '1', PORTAL_TEST_ENVIRONMENT_VERIFIED: '1',
    PORTAL_TEST_API_ORIGIN: input.backendOrigin });
  assert.match(plan.state, /plan only/);
  assert.deepEqual(readdirSync(input.binDirectory, { recursive: true }), before);
});

test('wrapper accepts replacement ports but refuses invalid or incomplete isolation settings', t => {
  const input = fixture(t);
  const plan = inventoryTestPlan({ ...input, website: 'http://localhost:5301/app/', backendOrigin: 'http://localhost:8988/' });
  assert.equal(plan.options.portalConnectURL, 'http://localhost:5301/app/connect');
  assert.equal(plan.options.syncEndpoint, 'http://localhost:8988/api/portal/sync-upload');
  assert.equal(plan.backendEnvironment.PORTAL_TEST_API_ORIGIN, 'http://localhost:8988');
  for (const change of [
    { testEnvironmentVerified: false }, { testEnvironmentVerified: undefined }, { testEnvironmentVerified: '1' },
    { binDirectory: undefined }, { website: undefined }, { backendOrigin: undefined },
    { website: 'https://omgskills.com/app/' }, { website: 'http://127.0.0.1/app/' },
    { website: 'http://127.0.0.1:5201/app/?token=fixture' }, { website: 'http://127.0.0.1:5201/app/#fragment' },
    { website: 'http://127.0.0.1:5201/app/preview/unified/' },
    { backendOrigin: 'https://omgskills.com' }, { backendOrigin: 'http://127.0.0.1' },
    { backendOrigin: 'http://127.0.0.1:5201' }, { backendOrigin: 'http://localhost:5201' },
    { backendOrigin: 'http://127.0.0.1:8888/api/portal/sync-upload' },
    { backendOrigin: 'http://user:fixture@127.0.0.1:8888' },
    { backendOrigin: 'http://127.0.0.1:8888/?secret=fixture' }, { backendOrigin: 'http://127.0.0.1:8888/#' },
  ]) assert.throws(() => inventoryTestPlan({ ...input, ...change }));
  assert.throws(() => inventoryTestPlan());
});

test('backend callback expectations reject inconsistent flags, production and nonexact origins', t => {
  const input = fixture(t);
  assert.equal(inventoryTestPlan({ ...input, backendEnvironment: { NODE_ENV: 'test' } }).backendEnvironment.NODE_ENV, 'test');
  for (const backendEnvironment of [
    { CONTEXT: 'production' }, { CONTEXT: 'deploy-preview' }, { CONTEXT: undefined },
    { NODE_ENV: 'production' }, { NODE_ENV: undefined },
    { OMGSKILLS_CONNECTED_INVENTORY_TEST: '0' }, { OMGSKILLS_CONNECTED_INVENTORY_TEST: undefined },
    { PORTAL_TEST_ENVIRONMENT_VERIFIED: '0' }, { PORTAL_TEST_ENVIRONMENT_VERIFIED: true },
    { PORTAL_TEST_ENVIRONMENT_VERIFIED: undefined },
    { PORTAL_TEST_API_ORIGIN: 'http://127.0.0.1:8888/' },
    { PORTAL_TEST_API_ORIGIN: 'http://localhost:8888' },
    { PORTAL_TEST_API_ORIGIN: 'http://127.0.0.1:8889' },
    { PORTAL_TEST_API_ORIGIN: 'http://127.0.0.1:5201' },
    { PORTAL_TEST_API_ORIGIN: 'https://omgskills.com' }, { PORTAL_TEST_API_ORIGIN: undefined },
  ]) assert.throws(() => inventoryTestPlan({ ...input, backendEnvironment }));
});

test('CLI parser defaults to plan only; --prepare only requests subsequent explicit assembly', t => {
  const input = fixture(t);
  const args = ['--bin-dir', input.binDirectory, '--website', input.website, '--backend-origin', input.backendOrigin,
    '--test-environment-verified'];
  assert.equal(inventoryTestCommand(args).prepareRequested, false);
  // Parsing this option does not invoke prepare or any external process.
  assert.equal(inventoryTestCommand([...args, '--prepare']).prepareRequested, true);
  assert.throws(() => inventoryTestCommand(args.filter(x => x !== '--test-environment-verified')));
  assert.throws(() => inventoryTestCommand([...args, '--token', 'fixture-secret']));
  assert.throws(() => inventoryTestCommand([...args, '--scheme', 'omgskills']));
  assert.throws(() => inventoryTestCommand([...args, '--root', '/Users/fixture']));
});

test('plan and diagnostics do not read, echo or retain credentials', t => {
  const input = fixture(t);
  const plan = inventoryTestPlan({ ...input, token: 'fixture-secret', CLERK_SECRET_KEY: 'fixture-secret',
    databaseURL: 'fixture-secret', keychainService: 'com.jonslimak.omgskills.portal-sync',
    backendEnvironment: { CLERK_SECRET_KEY: 'fixture-secret', SKILLGROUPS_DATABASE_URL: 'fixture-secret' } });
  assert.doesNotMatch(JSON.stringify(plan), /fixture-secret|CLERK_SECRET|databaseURL|keychainService/);
  assert.throws(() => inventoryTestPlan({ ...input, backendOrigin: 'http://user:fixture-secret@127.0.0.1:8888' }),
    error => !error.message.includes('fixture-secret'));
});

test('wrapper import is inert and its sole assembler call is behind explicit CLI and --prepare guards', () => {
  const source = readFileSync(new URL('./prepare-newmac-inventory-test.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/);
  assert.equal((source.match(/\bprepare\(/g) ?? []).length, 1);
  assert.match(source, /prepareRequested \? prepare\(plan\.binDirectory, plan\.website, plan\.options\) : plan/);
  assert.doesNotMatch(source, /execFile|spawn|process\.env|codesign|lsregister|\/usr\/bin\/open|fetch\(|writeFile|mkdir|mkdtemp/);
});
