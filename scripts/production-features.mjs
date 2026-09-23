import { readFile } from "node:fs/promises";

const defaultConfigUrl = new URL("../config/production-features.json", import.meta.url);

export async function loadProductionFeatures(configUrl = defaultConfigUrl) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(configUrl, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read production feature configuration: ${error.message}`);
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || typeof parsed.skillGroupsWebEnabled !== "boolean"
    || typeof parsed.skillGroupsAuthEnabled !== "boolean"
  ) {
    throw new Error("production-features.json must declare skillGroupsWebEnabled and skillGroupsAuthEnabled as booleans");
  }

  const unknownKeys = Object.keys(parsed).filter(
    (key) => key !== "skillGroupsWebEnabled" && key !== "skillGroupsAuthEnabled"
  );
  if (unknownKeys.length > 0) {
    throw new Error(`production-features.json contains unknown keys: ${unknownKeys.join(", ")}`);
  }
  if (parsed.skillGroupsAuthEnabled && !parsed.skillGroupsWebEnabled) {
    throw new Error("skillGroupsAuthEnabled requires skillGroupsWebEnabled");
  }

  return Object.freeze({
    skillGroupsWebEnabled: parsed.skillGroupsWebEnabled,
    skillGroupsAuthEnabled: parsed.skillGroupsAuthEnabled,
  });
}

export function portalBuildEnvironment(features, baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    VITE_SKILLGROUPS_WEB_ENABLED: features.skillGroupsWebEnabled ? "1" : "0",
    VITE_SKILLGROUPS_MAC_ENABLED: features.skillGroupsAuthEnabled ? "1" : "0",
  };
}

export function publicReleaseConfig(features) {
  return {
    version: 1,
    skillGroupsAuthEnabled: features.skillGroupsAuthEnabled,
  };
}
