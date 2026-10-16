import { readFile } from "node:fs/promises";
import { validateProductionFeatures } from "../config/production-features.mjs";

const defaultConfigUrl = new URL("../config/production-features.json", import.meta.url);

export async function loadProductionFeatures(configUrl = defaultConfigUrl) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configUrl, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read production feature configuration: ${error.message}`);
  }

  return validateProductionFeatures(parsed);
}

export function portalBuildEnvironment(features, baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    VITE_SKILLGROUPS_WEB_ENABLED: features.skillGroupsWebEnabled ? "1" : "0",
    VITE_SKILLGROUPS_MAC_ENABLED: features.skillGroupsAuthEnabled ? "1" : "0",
    VITE_PORTAL_REDESIGN_ENABLED: features.portalRedesignEnabled === true ? "1" : "0",
    VITE_PORTAL_UNIFIED_ENABLED: features.portalUnifiedEnabled === true ? "1" : "0",
    VITE_CATALOG_SEARCH_ENABLED: features.catalogSearchEnabled === true ? "1" : "0",
  };
}

export function publicReleaseConfig(features) {
  return {
    version: 1,
    skillGroupsAuthEnabled: features.skillGroupsAuthEnabled,
  };
}
