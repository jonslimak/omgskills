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
  /** The cloud save key this copy uses, from the server; older responses leave it out. */
  cloudKey?: string | null;
  gitRelativePath?: string | null;
  catalogSkillIdHint?: string | null;
  installedFromSet?: string | null;
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

/** A skill groups copies by name, so its copies may carry more than one catalog ID. */
export function hasCatalogId(skill: GroupedSyncedSkill, catalogId: string) {
  return skill.catalogSkillId === catalogId || skill.sourceSkills.some(copy => copy.catalogSkillId?.trim() === catalogId);
}

/** The different SKILL.md versions a skill's copies have now, each with the agents that have it. */
export function skillVersions(skill: GroupedSyncedSkill): string[][] {
  const bySha = new Map<string, string[]>();
  for (const copy of skill.sourceSkills) {
    const sha = copy.skillMdSha?.trim().toLowerCase();
    if (copy.isCurrent === false || !sha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) continue;
    bySha.set(sha, [...(bySha.get(sha) ?? []), copy.source]);
  }
  return [...bySha.values()].map(displaySourceNames).sort((a, b) => b.length - a.length || a.join().localeCompare(b.join()));
}

export function installedSetNames(skill: GroupedSyncedSkill): string[] {
  return [...new Set(skill.sourceSkills.flatMap(source => {
    const name = source.installedFromSet?.trim();
    return name ? [name] : [];
  }))].sort((a, b) => a.localeCompare(b));
}

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

/** One skill per name: copies in different agents or with different content are the same skill. */
function nameIdentity(skill: SyncedSkill) {
  return normalizedSkillText(skill.name) || null;
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

function chooseDisplayInstallation(skills: SyncedSkill[]) {
  let candidates = skills.filter(skill => skill.isCurrent === true);
  if (!candidates.length) candidates = skills.filter(skill => skill.isCurrent !== false);
  if (!candidates.length) candidates = skills;
  const deviceCopies = candidates.filter(skill => skill.deviceId != null);
  const versionedCopies = candidates.filter(skill => skill.inventoryVersion === 2 || skill.inventoryVersion === 3);
  candidates = deviceCopies.length ? deviceCopies : versionedCopies.length ? versionedCopies : candidates;
  // Copies can be different versions; act on the version most agents have.
  const counts = new Map<string, number>();
  for (const skill of candidates) counts.set(skill.skillMdSha ?? "", (counts.get(skill.skillMdSha ?? "") ?? 0) + 1);
  const top = Math.max(...counts.values());
  return chooseRepresentativeSkill(candidates.filter(skill => counts.get(skill.skillMdSha ?? "") === top));
}

export function groupSyncedSkills(skills: SyncedSkill[], { groupInstallations = false } = {}): GroupedSyncedSkill[] {
  const physicalGroups: SyncedSkill[][] = [];
  const displayGroups = new Map<string, SyncedSkill[]>();
  const catalogGroups = new Map<string, SyncedSkill[]>();
  const unresolvedSkills: SyncedSkill[] = [];

  for (const skill of skills) {
    if (groupInstallations) {
      // The same rule as the Mac's count: by name, whatever the catalog ID, agent or version.
      const identity = nameIdentity(skill) ?? skill.catalogSkillId?.trim();
      if (identity) {
        const group = displayGroups.get(identity) ?? [];
        group.push(skill);
        displayGroups.set(identity, group);
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
      const catalog = resolved.length ? chooseRepresentativeSkill(resolved) : null;
      // Actions use a current installation; catalog display fields may come from another copy.
      const representative = groupInstallations ? chooseDisplayInstallation(group) : chooseRepresentativeSkill(group);
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
        ...(catalog && { catalogSkillId: catalog.catalogSkillId, identityStatus: catalog.identityStatus, isLocalOnly: catalog.isLocalOnly }),
        description: bestDescription,
        githubUrl: catalog?.githubUrl ?? representative.githubUrl ?? group.find((skill) => skill.githubUrl)?.githubUrl ?? null,
        allSkillIds: group.map((skill) => skill.id),
        sourceSkills: group,
        sources
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}
