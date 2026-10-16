import { connectedInventoryTestEnabled, inventoryReconciliationTestEnabled } from "./connected-inventory-test";

const configuration = {
  enabled: import.meta.env.VITE_NEWMAC_CONNECTED_INVENTORY_TEST,
  development: import.meta.env.DEV,
  integration: import.meta.env.VITE_PORTAL_INTEGRATION,
  ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
  publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
  catalogInstall: import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST,
  legacyInstall: import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST,
  preview: import.meta.env.VITE_PORTAL_PREVIEW,
  hostname: location.hostname,
  protocol: location.protocol,
};
export const connectedInventoryTest = import.meta.env.DEV ? connectedInventoryTestEnabled(configuration) : false;
export const inventoryReconciliationTest = inventoryReconciliationTestEnabled({ ...configuration,
  reconciliation: import.meta.env.VITE_NEWMAC_INVENTORY_RECONCILIATION_TEST });
