#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loopbackURL, validateInputs, prepare } from './prepare-newmac-f1.mjs';

export function inventoryTestPlan({ binDirectory, website, backendOrigin, testEnvironmentVerified = false,
  backendEnvironment = {}, inventoryReconciliationTest = false, inventoryAutomationTest = false } = {}) {
  const browser = loopbackURL(website, 'Website');
  if (browser.pathname !== '/app/') throw new Error('Use the unified test website at /app/.');
  const backend = loopbackURL(backendOrigin, 'Backend origin');
  const options = { catalogInstall: true, connectedInventoryTest: true, testEnvironmentVerified,
    backendOrigin: backend.origin, portalConnectURL: new URL('/app/connect', browser).href,
    syncEndpoint: new URL('/api/portal/sync-upload', backend).href };
  if (inventoryReconciliationTest !== false) options.inventoryReconciliationTest = inventoryReconciliationTest;
  if (inventoryAutomationTest !== false) options.inventoryAutomationTest = inventoryAutomationTest;
  // Validate the original backend too: deriving an origin must not hide a bad path.
  const config = validateInputs(binDirectory, browser.href, { ...options, backendOrigin });
  const expectedBackend = { CONTEXT: 'dev', NODE_ENV: 'development', OMGSKILLS_CONNECTED_INVENTORY_TEST: '1',
    PORTAL_TEST_ENVIRONMENT_VERIFIED: '1', PORTAL_TEST_API_ORIGIN: config.backendOrigin };
  if (inventoryReconciliationTest) expectedBackend.OMGSKILLS_INVENTORY_RECONCILIATION_TEST = '1';
  // Read only named configuration values, never copy a caller's credentials into the plan.
  for (const key of Object.keys(expectedBackend)) {
    if (Object.hasOwn(backendEnvironment, key)) expectedBackend[key] = backendEnvironment[key];
  }
  if (expectedBackend.CONTEXT !== 'dev' || typeof expectedBackend.NODE_ENV !== 'string'
      || expectedBackend.NODE_ENV === 'production' || expectedBackend.OMGSKILLS_CONNECTED_INVENTORY_TEST !== '1'
      || expectedBackend.PORTAL_TEST_ENVIRONMENT_VERIFIED !== '1'
      || expectedBackend.PORTAL_TEST_API_ORIGIN !== config.backendOrigin) {
    throw new Error('Backend requires CONTEXT=dev, nonproduction NODE_ENV, both connected-test assertions=1 and the exact backend loopback origin.');
  }
  if (inventoryReconciliationTest && expectedBackend.OMGSKILLS_INVENTORY_RECONCILIATION_TEST !== '1') {
    throw new Error('Reconciliation requires the backend reconciliation test gate.');
  }
  return { binDirectory: config.bin, website: config.website, options,
    browserEnvironment: {
      VITE_PORTAL_INTEGRATION: '1', PORTAL_TEST_API_ORIGIN: config.backendOrigin,
      PORTAL_TEST_ENVIRONMENT_VERIFIED: '1', VITE_SKILLGROUPS_WEB_ENABLED: '1',
      VITE_NEWMAC_CATALOG_INSTALL_TEST: '1', VITE_NEWMAC_CONNECTED_INVENTORY_TEST: '1',
      ...(inventoryReconciliationTest ? { VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST: '1' } : {}),
    },
    backendEnvironment: expectedBackend,
    state: 'plan only; no app prepared, registered or launched; test assertion is not database/auth verification' };
}

export function inventoryTestCommand(args) {
  const { values } = parseArgs({ args, options: {
    'bin-dir': { type: 'string' }, website: { type: 'string' }, 'backend-origin': { type: 'string' },
    'test-environment-verified': { type: 'boolean', default: false },
    'inventory-reconciliation-test': { type: 'boolean', default: false },
    'inventory-automation-test': { type: 'boolean', default: false },
    prepare: { type: 'boolean', default: false },
  } });
  const plan = inventoryTestPlan({ binDirectory: values['bin-dir'], website: values.website,
    backendOrigin: values['backend-origin'], testEnvironmentVerified: values['test-environment-verified'],
    inventoryReconciliationTest: values['inventory-reconciliation-test'], inventoryAutomationTest: values['inventory-automation-test'] });
  return { plan, prepareRequested: values.prepare };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { plan, prepareRequested } = inventoryTestCommand(process.argv.slice(2));
  // Only an explicit CLI invocation with --prepare reaches the existing F1 assembler.
  const result = prepareRequested ? prepare(plan.binDirectory, plan.website, plan.options) : plan;
  console.log(JSON.stringify(result, null, 2));
}
