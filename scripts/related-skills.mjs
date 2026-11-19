// Related skills for a skill page: other creators' skills for the same job.
// Two skills are related when their names and descriptions share words that are rare in the
// catalog ("figma", "playwright"), not just common ones ("store", "service", "change").
// Only strong matches; no strong match means no section.

// Words that say nothing about the job.
const genericWords = new Set(["skill", "skills", "agent", "agents", "claude", "codex", "code", "pro", "expert", "helper", "tools", "tool", "the"]);
const fillerWords = new Set(["a", "an", "and", "the", "to", "for", "from", "of", "in", "on", "with", "my", "me", "i", "we", "our",
  "it", "is", "be", "can", "you", "please", "help", "make", "want", "need", "how", "do", "that", "this", "some", "using", "use",
  "when", "user", "users", "asks", "also", "your", "what", "into", "them", "they", "their", "will", "should", "about", "like",
  "such", "other", "more", "then", "than", "only", "each", "every", "work", "working", "task", "tasks", "used", "guide", "guides",
  "create", "build", "builds", "write", "writes", "across", "based", "including", "support", "provide", "provides", "handle"]);

export const relatedLimit = 5;
// Skill ID -> related skill IDs, for the app panel.
export const relatedSkillsFilename = "catalog-related-skills.json";
// How much rare shared wording two skills need, and how many distinct shared words.
const minScore = 14;
const minSharedWords = 3;

function singular(word) {
  return word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function words(text) {
  return new Set(String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !fillerWords.has(word) && !genericWords.has(word))
    .map(singular));
}

const author = skill => String(skill.author_handle || "").toLowerCase();
const nameKey = skill => String(skill.name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const aboutKey = skill => String(skill.description || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Builds a picker over the skills that have pages. `topicsBySkill` maps a skill ID to the editorial
 * (non-creator) collection IDs it is in; sharing one adds to the score.
 */
export function relatedSkillsPicker(pool, { topicsBySkill = new Map(), limit = relatedLimit } = {}) {
  const facts = pool.map(skill => {
    const name = words(skill.name);
    const all = new Set([...name, ...words(skill.description)]);
    return { skill, author: author(skill), nameKey: nameKey(skill), aboutKey: aboutKey(skill), name, all, topics: new Set(topicsBySkill.get(skill.id) || []) };
  });
  const byId = new Map(facts.map(fact => [fact.skill.id, fact]));
  // Rarer words say more: weight = log(pool size / skills using the word).
  const df = new Map();
  for (const fact of facts) for (const word of fact.all) df.set(word, (df.get(word) || 0) + 1);
  const weight = word => Math.log(facts.length / (df.get(word) || 1));
  // Words in more than 2% of skills don't find candidates on their own.
  const common = Math.max(20, facts.length * 0.02);
  // A name word in at most 1% of skills names a specific job.
  const rare = Math.max(10, facts.length * 0.01);
  const byWord = new Map();
  for (const fact of facts) {
    for (const word of fact.all) if (df.get(word) <= common) (byWord.get(word) ?? byWord.set(word, []).get(word)).push(fact);
  }
  const decade = stars => Math.floor(Math.log10(Math.max(Number(stars) || 0, 0) + 1));

  return function related(skill, { exclude = new Set() } = {}) {
    const base = byId.get(skill.id);
    if (!base) return [];
    const candidates = new Set([...base.all].flatMap(word => byWord.get(word) || []));
    const scored = [];
    for (const other of candidates) {
      // Other creators only: the creator's own skills have their own section. Another creator's
      // skill of the same name counts unless it's a copy (same name and description).
      const copy = other.nameKey === base.nameKey && other.aboutKey === base.aboutKey;
      if (other.skill.id === skill.id || other.author === base.author || copy || exclude.has(other.skill.id)) continue;
      let score = 0, shared = 0, sameJob = false;
      for (const word of base.all) {
        if (!other.all.has(word)) continue;
        shared += 1;
        // A word in both names says the most about the job; a rare one ("figma") means the same job.
        const inNames = base.name.has(word) && other.name.has(word);
        if (inNames && df.get(word) <= rare) sameJob = true;
        score += weight(word) * (inNames ? 2 : 1);
      }
      const sameTopic = [...base.topics].some(topic => other.topics.has(topic));
      if (sameTopic) score += 4;
      // A shared collection alone is broad ("Business"), so it needs more shared wording.
      if (!(sameJob || (sameTopic && score >= minScore * 1.5)) || score < minScore || shared < minSharedWords) continue;
      scored.push({ other, score });
    }
    scored.sort((a, b) => b.score - a.score || decade(b.other.skill.stars) - decade(a.other.skill.stars)
      || (b.other.skill.stars || 0) - (a.other.skill.stars || 0) || String(a.other.skill.id).localeCompare(String(b.other.skill.id)));
    // At most two from one creator, so one big repo can't fill the list; one copy of each name.
    const kept = [];
    for (const { other } of scored) {
      if (kept.length >= limit) break;
      if (kept.filter(earlier => earlier.author === other.author).length >= 2 || kept.some(earlier => earlier.nameKey === other.nameKey)) continue;
      kept.push(other);
    }
    return kept.map(other => other.skill);
  };
}
