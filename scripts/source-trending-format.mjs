// Shared by the producer, publication checks, and the web reader.
import { normalizePolicyRepo, normalizePolicyHandle, normalizePolicySkillId } from "./policy-identifiers.mjs";

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
      || (entry.fresh !== undefined && entry.fresh !== true)
      || entry.sourceUrl !== sourceTrendingUrl(entry.source, entry.skillId)
      || (entry.catalogId !== undefined && (typeof entry.catalogId !== "string" || !entry.catalogId.trim()))) fail();
    const key = `${entry.source}:${entry.skillId}`.toLowerCase();
    if (seen.has(key)) fail();
    seen.add(key);
    lastRank = entry.rank;
  }
  return value;
}

// Repo of a library skill, lowercased: its GitHub URL, else repo_slug, else the ID prefix.
const skillRepo = skill => (skill.github_url?.match(/^https:\/\/github\.com\/([^/]+\/[^/?#]+)/i)?.[1]?.replace(/\.git$/i, "")
  ?? skill.repo_slug ?? skill.id.split(":")[0]).toLowerCase();
// Folder that holds the skill's SKILL.md (skills.sh names skills by it); none for a root SKILL.md.
const skillFolder = skill => {
  const path = (skill.skill_md_path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = path ? path.split("/") : skill.id.split(":").slice(1).join(":").split("/").concat("SKILL.md");
  return parts.length >= 2 ? parts.at(-2).toLowerCase() : undefined;
};

/**
 * Same-repo, same-folder library skills, keyed "owner/repo:folder". Library IDs often carry the
 * folder path ("owner/repo:skills/copywriting") while skills.sh uses the folder name ("copywriting").
 * Ambiguous keys (two library skills) are dropped; a display name alone never links.
 */
function skillsByRepoFolder(skills) {
  const map = new Map();
  for (const skill of skills) {
    const folder = skillFolder(skill);
    if (!folder) continue;
    const key = `${skillRepo(skill)}:${folder}`;
    map.set(key, map.has(key) ? null : skill);
  }
  return map;
}

/** Hidden by the Trending intake: skills it blocked, and unreviewed skills from repos it found copying. */
export function intakeHiddenPolicy(state) {
  const reviews = Array.isArray(state?.reviews) ? state.reviews : [];
  const blocked = reviews.filter(review => review?.outcome === "blocked" && typeof review.sourceId === "string");
  return {
    reviewBlockedIds: blocked.map(review => review.sourceId),
    copyRepos: [...new Set(blocked.filter(review => review.reason === "non-original-provenance")
      .map(review => review.sourceId.split(":")[0]))],
  };
}

export function filterSourceTrending(feed, policy, skills) {
  validateSourceTrending(feed);
  const reviewBlocked = new Set((policy.reviewBlockedIds ?? []).map(id => id.toLowerCase()));
  const copyRepos = new Set((policy.copyRepos ?? []).map(repo => repo.toLowerCase()));
  const byRepoFolder = skillsByRepoFolder(skills);
  const blockedRepos = new Set([...policy.blockedRepos, ...policy.catalogRepos].map(normalizePolicyRepo));
  const blockedOwners = new Set(policy.blockedOwners.map(normalizePolicyHandle));
  const suppressed = new Set(policy.suppressedIds.map(normalizePolicySkillId));
  const byId = new Map(skills.map(skill => [skill.id, skill]));
  const byExactSource = new Map(skills.map(skill => [skill.id.toLowerCase(), skill]));
  const blocked = repo => {
    const normalized = normalizePolicyRepo(repo);
    return blockedRepos.has(normalized) || blockedOwners.has(normalized.split("/")[0]);
  };
  return { ...feed, entries: feed.entries.flatMap(entry => {
    if (blocked(entry.source) || suppressed.has(`${entry.source}:${entry.skillId}`.toLowerCase())
      || (entry.catalogId && suppressed.has(entry.catalogId.toLowerCase()))) return [];
    const sourceId = `${entry.source}:${entry.skillId}`.toLowerCase();
    const skill = byId.get(entry.catalogId) ?? byExactSource.get(sourceId) ?? byRepoFolder.get(sourceId) ?? undefined;
    // Library skills always show; anything else the intake blocked, or that comes from a copying repo, does not.
    if (!skill && (reviewBlocked.has(sourceId) || copyRepos.has(entry.source.toLowerCase()))) return [];
    const publisher = skill?.github_url?.match(/^https:\/\/github\.com\/([^/]+\/[^/?#]+)/i)?.[1]?.replace(/\.git$/i, "");
    if (skill && (blocked(skill.id.split(":")[0]) || (skill.repo_slug && blocked(skill.repo_slug))
      || (publisher && blocked(publisher)))) return [];
    // A retained snapshot may refer to a skill removed since its last refresh.
    const { catalogId: _catalogId, ...external } = entry;
    return [{ ...external, ...(skill ? { catalogId: skill.id } : {}) }];
  }) };
}

export const SOURCE_TRENDING_RISING_PER_REPO = 2;

/** New and rising: the new skills on the list, in its order (24h installs), with no repo filling it. */
export function risingSourceTrending(entries) {
  const perRepo = new Map();
  return entries.filter(entry => {
    if (!entry.fresh) return false;
    const repo = entry.source.toLowerCase();
    const count = perRepo.get(repo) ?? 0;
    perRepo.set(repo, count + 1);
    return count < SOURCE_TRENDING_RISING_PER_REPO;
  });
}

/** Weeks counted as "recent" when deciding whether a skill is new. */
const FRESH_RECENT_WEEKS = 3;

/**
 * New on skills.sh: nearly all its installs came in the last few weeks. `weeklyInstalls` is the
 * all-time board's per-week history, oldest first.
 */
export function isFreshSkill(weeklyInstalls) {
  if (!Array.isArray(weeklyInstalls) || weeklyInstalls.length <= FRESH_RECENT_WEEKS) return false;
  const counts = weeklyInstalls.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const recent = counts.slice(-FRESH_RECENT_WEEKS).reduce((sum, value) => sum + value, 0);
  const older = counts.slice(0, -FRESH_RECENT_WEEKS).reduce((sum, value) => sum + value, 0);
  return recent > 0 && older <= 0.1 * recent;
}
