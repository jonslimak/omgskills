// Account/detail reads are deliberately separated from all mutation transports.
export function isPortalRead(path: string, method = "GET", connectedInventory = false, inventoryReconciliation = false) {
  return method.toUpperCase() === "GET" &&
    (/^\/api\/portal\/(?:synced-skills|groups|shared|profile|devices|private-sources|groups\/[a-zA-Z0-9_-]+)$/.test(path)
      || (connectedInventory && path === "/api/portal/synced-skills?version=2")
      || (connectedInventory && inventoryReconciliation && path === "/api/portal/synced-skills?version=3"));
}
