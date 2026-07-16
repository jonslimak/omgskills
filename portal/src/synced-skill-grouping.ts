export type SyncedSkill = {
  id: string;
  name: string;
  description: string | null;
  skillMdSha?: string | null;
  identityStatus?: "resolved" | "ambiguous" | "localOnly";
  catalogSkillId?: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
  lastSeenAt: string;
};

export type GroupedSyncedSkill = SyncedSkill & {
  allSkillIds: string[];
  sourceSkills: SyncedSkill[];
  sources: string[];
};

function normalizedSkillText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedDescriptionWords(value: string | null | undefined) {
  return normalizedSkillText(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
}

function descriptionsMatch(first: string | null | undefined, second: string | null | undefined) {
  const normalizedFirst = normalizedSkillText(first);
  const normalizedSecond = normalizedSkillText(second);

  if (normalizedFirst === normalizedSecond) {
    return true;
  }
  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }
  if (
    Math.min(normalizedFirst.length, normalizedSecond.length) >= 35 &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst))
  ) {
    return true;
  }

  const firstWords = new Set(normalizedDescriptionWords(normalizedFirst));
  const secondWords = new Set(normalizedDescriptionWords(normalizedSecond));
  const smallerSize = Math.min(firstWords.size, secondWords.size);

  let shared = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) {
      shared += 1;
    }
  }

  if (smallerSize >= 3 && smallerSize < 5) {
    return shared / smallerSize >= 0.8;
  }
  if (smallerSize < 5) {
    return false;
  }
  return shared / smallerSize >= 0.72;
}

function normalizedSource(value: string) {
  return value.toLowerCase();
}

export function hasSource(skill: GroupedSyncedSkill, source: string) {
  const target = source.toLowerCase();
  return skill.sources.some((item) => normalizedSource(item).includes(target));
}

function chooseRepresentativeSkill(skills: SyncedSkill[]) {
  const representative =
    skills.find((skill) => normalizedSource(skill.source).includes("codex")) ??
    skills.find((skill) => Boolean(skill.githubUrl)) ??
    [...skills].sort((first, second) => first.source.localeCompare(second.source))[0];

  if (!representative) {
    throw new Error("Cannot group empty synced skill set");
  }
  return representative;
}

export function groupSyncedSkills(skills: SyncedSkill[]): GroupedSyncedSkill[] {
  const catalogGroups = new Map<string, SyncedSkill[]>();
  const unresolvedSkills: SyncedSkill[] = [];

  for (const skill of skills) {
    const catalogSkillId = skill.catalogSkillId?.trim();
    if (catalogSkillId) {
      const group = catalogGroups.get(catalogSkillId) ?? [];
      group.push(skill);
      catalogGroups.set(catalogSkillId, group);
    } else {
      unresolvedSkills.push(skill);
    }
  }

  const unresolvedGroups: SyncedSkill[][] = [];
  for (const skill of unresolvedSkills) {
    const skillName = normalizedSkillText(skill.name);
    const matchingGroup = unresolvedGroups.find((group) => {
      const firstSkill = group[0];
      if (normalizedSkillText(firstSkill.name) !== skillName) {
        return false;
      }
      if (skill.githubUrl && firstSkill.githubUrl && skill.githubUrl === firstSkill.githubUrl) {
        return true;
      }
      return group.some((groupSkill) => descriptionsMatch(groupSkill.description, skill.description));
    });

    if (matchingGroup) {
      matchingGroup.push(skill);
    } else {
      unresolvedGroups.push([skill]);
    }
  }

  return [...catalogGroups.values(), ...unresolvedGroups]
    .map((group) => {
      const representative = chooseRepresentativeSkill(group);
      const bestDescription =
        [...group]
          .map((skill) => skill.description)
          .filter((description): description is string => Boolean(description))
          .sort((first, second) => second.length - first.length)[0] ?? null;
      const sources = [...new Set(group.map((skill) => skill.source))].sort((first, second) =>
        first.localeCompare(second)
      );
      return {
        ...representative,
        description: bestDescription,
        githubUrl: representative.githubUrl ?? group.find((skill) => skill.githubUrl)?.githubUrl ?? null,
        allSkillIds: group.map((skill) => skill.id),
        sourceSkills: group,
        sources
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}
