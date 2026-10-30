export type ScanCoverage = {
  source: "claude" | "codex" | "agents";
  state: "complete" | "incomplete" | "unavailable";
  reason?: "changed" | "invalid-entry" | "invalid-metadata" | "missing" | "unreadable" | "redirected";
};

export type SyncedSkill = {
  inventoryVersion?: 2 | 3;
  isCurrent?: boolean;
  scanCoverage?: ScanCoverage[] | null;
  deviceId?: string | null;
  deviceName?: string | null;
  deviceStatus?: "active" | "revoked" | "expired" | "inactive" | null;
  lastReportedAt?: string | null;
  installationFolder?: string | null;
  gitRelativePath?: string | null;
  catalogSkillIdHint?: string | null;
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

export function displaySourceName(value: string) {
  const source = value.trim();
  switch (source.toLowerCase()) {
    case "claude":
    case "claude code": return "Claude";
    case "codex": return "Codex";
    case "agents": return "Agents";
    default: return source;
  }
}

export function displaySourceNames(sources: string[]) {
  return [...new Set(sources.map(displaySourceName))].sort((a, b) => a.localeCompare(b));
}

function contentIdentity(skill: SyncedSkill) {
  const name = normalizedSkillText(skill.name);
  const fingerprint = skill.skillMdSha?.trim().toLowerCase();
  return name && fingerprint && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fingerprint)
    ? JSON.stringify([name, fingerprint]) : null;
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

export function groupSyncedSkills(skills: SyncedSkill[], { groupInstallations = false } = {}): GroupedSyncedSkill[] {
  const physicalGroups: SyncedSkill[][] = [];
  const displayGroups = new Map<string, SyncedSkill[]>();
  const catalogGroups = new Map<string, SyncedSkill[]>();
  const unresolvedSkills: SyncedSkill[] = [];

  for (const skill of skills) {
    if (groupInstallations) {
      const catalogId = skill.catalogSkillId?.trim();
      const identity = catalogId || contentIdentity(skill);
      if (identity) {
        const groups = catalogId ? catalogGroups : displayGroups;
        const group = groups.get(identity) ?? [];
        group.push(skill);
        groups.set(identity, group);
        continue;
      }
    }
    // Mutation callers retain the original physical identities and source labels.
    if (skill.inventoryVersion === 2 || skill.inventoryVersion === 3 || skill.deviceId != null) {
      physicalGroups.push([skill]);
      continue;
    }
    const catalogSkillId = skill.catalogSkillId?.trim();
    if (catalogSkillId) {
      const group = catalogGroups.get(catalogSkillId) ?? [];
      group.push(skill);
      catalogGroups.set(catalogSkillId, group);
    } else {
      unresolvedSkills.push(skill);
    }
  }

  if (groupInstallations) {
    const catalogIdsByContent = new Map<string, Set<string>>();
    for (const [catalogId, group] of catalogGroups) {
      for (const skill of group) {
        const key = contentIdentity(skill);
        if (!key) continue;
        const matches = catalogIdsByContent.get(key) ?? new Set<string>();
        matches.add(catalogId);
        catalogIdsByContent.set(key, matches);
      }
    }
    // An exact copy may join one known identity, but must never bridge conflicting catalog IDs.
    for (const [key, group] of displayGroups) {
      const matches = catalogIdsByContent.get(key);
      if (matches?.size !== 1) continue;
      const [catalogId] = matches;
      catalogGroups.get(catalogId)!.push(...group);
      displayGroups.delete(key);
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

  return [...physicalGroups, ...displayGroups.values(), ...catalogGroups.values(), ...unresolvedGroups]
    .map((group) => {
      const resolved = groupInstallations ? group.filter(skill => skill.catalogSkillId?.trim()) : [];
      const representative = chooseRepresentativeSkill(resolved.length ? resolved : group);
      const bestDescription =
        [...group]
          .map((skill) => skill.description)
          .filter((description): description is string => Boolean(description))
          .sort((first, second) => second.length - first.length)[0] ?? null;
      const sources = groupInstallations
        ? displaySourceNames(group.map(skill => skill.source))
        : [...new Set(group.map((skill) => skill.source))].sort((first, second) => first.localeCompare(second));
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
