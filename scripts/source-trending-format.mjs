// Shared by the producer, publication checks, and the web reader.
export const SOURCE_TRENDING_MAX_ENTRIES = 500;
export const SOURCE_TRENDING_STALE_MS = 36 * 60 * 60 * 1000;
const sourcePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99})?$/;

export function sourceTrendingUrl(source, skillId) {
  return `https://skills.sh/${source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(skillId)}`;
}

export function validateSourceTrending(value) {
  const fail = () => { throw new Error("Invalid source Trending feed"); };
  if (!value || value.version !== 1 || value.source !== "skills.sh" || value.board !== "trending"
    || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))
    || !Array.isArray(value.entries) || value.entries.length > SOURCE_TRENDING_MAX_ENTRIES) fail();
  const seen = new Set();
  let lastRank = 0;
  for (const entry of value.entries) {
    if (!entry || typeof entry.source !== "string" || !sourcePattern.test(entry.source)
      || entry.source.split("/").some(part => part === "." || part === "..")
      || typeof entry.skillId !== "string" || !entry.skillId.trim() || entry.skillId.length > 200
      || /[\x00-\x1f\x7f]/.test(entry.skillId) || [".", ".."].includes(entry.skillId)
      || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 300
      || !Number.isSafeInteger(entry.rank) || entry.rank <= lastRank
      || !Number.isSafeInteger(entry.installs24h) || entry.installs24h < 0
      || entry.sourceUrl !== sourceTrendingUrl(entry.source, entry.skillId)
      || (entry.catalogId !== undefined && (typeof entry.catalogId !== "string" || !entry.catalogId.trim()))) fail();
    const key = `${entry.source}:${entry.skillId}`.toLowerCase();
    if (seen.has(key)) fail();
    seen.add(key);
    lastRank = entry.rank;
  }
  return value;
}

export function filterSourceTrending(feed, policy, skills) {
  validateSourceTrending(feed);
  const lowerSet = values => new Set(values.map(value => value.trim().toLowerCase()));
  const blockedRepos = lowerSet([...policy.blockedRepos, ...policy.catalogRepos]);
  const blockedOwners = lowerSet(policy.blockedOwners);
  const suppressed = lowerSet(policy.suppressedIds);
  const byId = new Map(skills.map(skill => [skill.id, skill]));
  const blocked = (repo) => blockedRepos.has(repo.toLowerCase()) || blockedOwners.has(repo.split("/")[0].toLowerCase());
  return { ...feed, entries: feed.entries.flatMap(entry => {
    if (blocked(entry.source) || suppressed.has(`${entry.source}:${entry.skillId}`.toLowerCase())
      || (entry.catalogId && suppressed.has(entry.catalogId.toLowerCase()))) return [];
    const skill = byId.get(entry.catalogId);
    const publisher = skill?.github_url?.match(/^https:\/\/github\.com\/([^/]+\/[^/?#]+)/i)?.[1]?.replace(/\.git$/i, "");
    if (skill && (blocked(skill.id.split(":")[0]) || (skill.repo_slug && blocked(skill.repo_slug))
      || (publisher && blocked(publisher)))) return [];
    // A retained snapshot may refer to a skill removed since its last refresh.
    const { catalogId, ...external } = entry;
    return [{ ...external, ...(skill ? { catalogId } : {}) }];
  }) };
}
