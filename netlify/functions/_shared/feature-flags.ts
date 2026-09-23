import productionFeatures from "../../../config/production-features.json" with { type: "json" };

type SkillGroupsFeatureConfig = {
  skillGroupsWebEnabled?: unknown;
  skillGroupsAuthEnabled?: unknown;
};

export function isSkillGroupsWebEnabled(
  config: SkillGroupsFeatureConfig = productionFeatures
): boolean {
  return config.skillGroupsWebEnabled === true;
}

export function requireSkillGroupsWebFeature(
  config: SkillGroupsFeatureConfig = productionFeatures
): void {
  if (!isSkillGroupsWebEnabled(config)) {
    throw new Response("Skill Groups are temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "300" }
    });
  }
}

export function isSkillGroupsFeatureEnabled(
  config: SkillGroupsFeatureConfig = productionFeatures
): boolean {
  return config.skillGroupsAuthEnabled === true;
}

export function requireSkillGroupsFeature(
  config: SkillGroupsFeatureConfig = productionFeatures
): void {
  if (!isSkillGroupsFeatureEnabled(config)) {
    throw new Response("Skill Groups are temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "300" }
    });
  }
}
