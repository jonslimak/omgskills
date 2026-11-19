// One creator's copies of the same skill (a plugin copy next to the skills/ copy, a renamed repo
// next to the old one) show the same SKILL.md text. Google should list one page, so each copy
// names the main copy as its canonical page.

// Text shorter than this is too generic to call two pages copies of each other.
const minDuplicateTextLength = 200;

/**
 * `entries`: one per generated skill page: { skill, urlPath, indexable, isEditorial, isTrending }.
 * `textFor(skill)`: the skill's page text. Returns copy page path -> main page path.
 * The main copy is a listed (indexable) page: editorial first, then trending, then the most stars,
 * then the shortest address. Copies with no listed page among them are left alone.
 */
export function duplicateSkillPages(entries, textFor) {
  const groups = new Map();
  for (const entry of entries) {
    const text = String(textFor(entry.skill) || "");
    if (text.length < minDuplicateTextLength) continue;
    const key = `${String(entry.skill.author_handle || "").toLowerCase()}\n${text}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(entry);
  }
  const rank = (entry) => [entry.indexable ? 0 : 1, entry.isEditorial ? 0 : 1, entry.isTrending ? 0 : 1, -(Number(entry.skill.stars) || 0), entry.urlPath.length];
  const mainPathByCopy = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return a.urlPath.localeCompare(b.urlPath);
    });
    if (!group[0].indexable) continue;
    for (const copy of group.slice(1)) mainPathByCopy.set(copy.urlPath, group[0].urlPath);
  }
  return mainPathByCopy;
}
