export function validateProductionFeatures(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || typeof parsed.skillGroupsWebEnabled !== "boolean" || typeof parsed.skillGroupsAuthEnabled !== "boolean") {
    throw new Error("production-features.json must declare skillGroupsWebEnabled and skillGroupsAuthEnabled as booleans");
  }
  const optional = ["portalRedesignEnabled", "portalUnifiedEnabled", "catalogSearchEnabled",
    "connectedInventoryReadEnabled", "connectedInventorySyncEnabled", "takeoverPilotEnabled"];
  for (const key of optional) {
    if (parsed[key] !== undefined && typeof parsed[key] !== "boolean") throw new Error(`${key} must be a boolean when present`);
  }
  const unknown = Object.keys(parsed).filter(key => !["skillGroupsWebEnabled", "skillGroupsAuthEnabled", ...optional].includes(key));
  if (unknown.length) throw new Error(`production-features.json contains unknown keys: ${unknown.join(", ")}`);
  if (parsed.skillGroupsAuthEnabled && !parsed.skillGroupsWebEnabled) throw new Error("skillGroupsAuthEnabled requires skillGroupsWebEnabled");
  if (parsed.connectedInventoryReadEnabled && (!parsed.skillGroupsWebEnabled || !parsed.portalUnifiedEnabled)) {
    throw new Error("connectedInventoryReadEnabled requires the unified web app");
  }
  if (parsed.connectedInventorySyncEnabled && !parsed.connectedInventoryReadEnabled) {
    throw new Error("connectedInventorySyncEnabled requires connectedInventoryReadEnabled");
  }
  if (parsed.takeoverPilotEnabled && !parsed.portalUnifiedEnabled) {
    throw new Error("takeoverPilotEnabled requires the unified web app");
  }
  return Object.freeze({ skillGroupsWebEnabled: parsed.skillGroupsWebEnabled, skillGroupsAuthEnabled: parsed.skillGroupsAuthEnabled,
    portalRedesignEnabled: parsed.portalRedesignEnabled === true, portalUnifiedEnabled: parsed.portalUnifiedEnabled === true,
    catalogSearchEnabled: parsed.catalogSearchEnabled === true,
    connectedInventoryReadEnabled: parsed.connectedInventoryReadEnabled === true,
    connectedInventorySyncEnabled: parsed.connectedInventorySyncEnabled === true,
    takeoverPilotEnabled: parsed.takeoverPilotEnabled === true });
}
