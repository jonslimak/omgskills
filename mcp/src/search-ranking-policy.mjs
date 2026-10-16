export const collectionOriginPolicy = "collection-origin-v1";
// Versioned snapshot of Skill.collectionLikePublisherRepos; not an admission denylist.
export const collectionLikePublishers = Object.freeze([
  "affaan-m/ecc", "affaan-m/everything-claude-code", "aiskillstore/marketplace",
  "francostino/opencode-skills-collection", "neversight/learn-skills.dev",
  "openclaw/openclaw", "openclaw/skills", "orcaqubits/agentic-commerce-skills-plugins",
  "sickn33/antigravity-awesome-skills",
]);
const publishers = new Set(collectionLikePublishers);
export function isCollectionLike(record) {
  return record.provenance_type === "catalog" || record.provenance_type === "repackaged"
    || (typeof record.publisher_repo === "string" && publishers.has(record.publisher_repo.toLowerCase()));
}
export function collectionLikeIds(records) {
  return records.filter(isCollectionLike).map(record => record.id).sort();
}
