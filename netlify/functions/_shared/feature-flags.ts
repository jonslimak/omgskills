import productionFeatures from "../../../config/production-features.json" with { type: "json" };

type SkillGroupsFeatureConfig = {
  skillGroupsAuthEnabled?: unknown;
};

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
