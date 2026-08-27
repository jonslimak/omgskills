export const GROUP_MANIFEST_TYPE = "omgskills.skill_group" as const;
export const GROUP_MANIFEST_VERSION = 2 as const;

export const groupManifestMetadataOnlyReasons = [
  "release_unavailable",
  "source_unavailable",
  "source_mismatch",
  "incomplete_release",
  "invalid_release",
  "release_source_mismatch",
  "synced_missing",
  "synced_local_only",
  "synced_ambiguous",
  "synced_unresolved"
] as const;

export type GroupManifestMetadataOnlyReason =
  (typeof groupManifestMetadataOnlyReasons)[number];

export type GroupManifestSourceKind = "catalog" | "public_github" | "private_github";

export type GroupManifestSourceInput = {
  id: string;
  kind: GroupManifestSourceKind | string;
  normalizedRoot?: string | null;
  catalogSkillId?: string | null;
  repositoryId?: string | null;
  repositorySlug?: string | null;
  tombstonedAt?: Date | string | null;
};

export type GroupManifestReleaseInput = {
  id?: string | null;
  sourceId?: string | null;
  commitSha?: string | null;
  treeSha?: string | null;
  skillMdSha?: string | null;
};

export type GroupManifestSyncedIdentityInput = {
  identityStatus?: "resolved" | "ambiguous" | "localOnly" | string | null;
  catalogSkillId?: string | null;
  isCurrent?: boolean | null;
};

export type GroupManifestItemInput = {
  id: string;
  kind: "catalog" | "github" | "synced";
  position: number;
  name: string;
  description?: string | null;
  note?: string | null;
  catalogSkillId?: string | null;
  metadataOnlyReason?: string | null;
  source?: GroupManifestSourceInput | null;
  release?: GroupManifestReleaseInput | null;
  syncedIdentity?: GroupManifestSyncedIdentityInput | null;
};

export type GroupManifestInput = {
  group: {
    id: string;
    name: string;
    description?: string | null;
    slug: string;
    revision: number;
  };
  items: GroupManifestItemInput[];
};

type ManifestRelease = {
  id: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
};

type ManifestSource =
  | {
      id: string;
      kind: "catalog";
      catalogSkillId: string;
      normalizedRoot: string;
    }
  | {
      id: string;
      kind: "public_github";
      repositoryId: string;
      repositorySlug: string;
      normalizedRoot: string;
    }
  | {
      id: string;
      kind: "private_github";
    };

export type GroupManifestItem = {
  id: string;
  kind: GroupManifestItemInput["kind"];
  position: number;
  name: string;
  description: string | null;
  note: string | null;
  installability:
    | {
        status: "installable";
        source: ManifestSource;
        release: ManifestRelease;
      }
    | {
        status: "metadata_only";
        reason: GroupManifestMetadataOnlyReason;
      };
};

export type GroupManifest = {
  type: typeof GROUP_MANIFEST_TYPE;
  version: typeof GROUP_MANIFEST_VERSION;
  group: {
    id: string;
    name: string;
    description: string | null;
    slug: string;
    revision: number;
  };
  items: GroupManifestItem[];
};

const shaPattern = /^[0-9a-f]{40}$/;
const metadataOnlyReasonSet = new Set<string>(groupManifestMetadataOnlyReasons);

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireItemKind(value: unknown): GroupManifestItemInput["kind"] {
  if (value !== "catalog" && value !== "github" && value !== "synced") {
    throw new Error("item kind must be catalog, github, or synced");
  }
  return value;
}

function explicitMetadataOnlyReason(
  value: unknown
): GroupManifestMetadataOnlyReason | null {
  return typeof value === "string" && metadataOnlyReasonSet.has(value)
    ? value as GroupManifestMetadataOnlyReason
    : null;
}

function syncedMetadataOnlyReason(
  identity: GroupManifestSyncedIdentityInput | null | undefined
): GroupManifestMetadataOnlyReason {
  if (!identity || identity.isCurrent === false) {
    return "synced_missing";
  }
  if (identity.identityStatus === "localOnly") {
    return "synced_local_only";
  }
  if (identity.identityStatus === "ambiguous") {
    return "synced_ambiguous";
  }
  if (identity.identityStatus !== "resolved" || !optionalText(identity.catalogSkillId)) {
    return "synced_unresolved";
  }
  return "release_unavailable";
}

function metadataOnly(
  reason: GroupManifestMetadataOnlyReason
): GroupManifestItem["installability"] {
  return { status: "metadata_only", reason };
}

function normalizeInstallability(
  item: GroupManifestItemInput
): GroupManifestItem["installability"] {
  const explicitReason = explicitMetadataOnlyReason(item.metadataOnlyReason);
  if (explicitReason) {
    return metadataOnly(explicitReason);
  }

  const source = item.source;
  const release = item.release;
  if (!source && !release) {
    return metadataOnly(
      item.kind === "synced"
        ? syncedMetadataOnlyReason(item.syncedIdentity)
        : "release_unavailable"
    );
  }
  if (!source || source.tombstonedAt) {
    return metadataOnly("source_unavailable");
  }
  if (!release) {
    return metadataOnly(
      item.kind === "synced"
        ? syncedMetadataOnlyReason(item.syncedIdentity)
        : "release_unavailable"
    );
  }

  const releaseId = optionalText(release.id);
  const releaseSourceId = optionalText(release.sourceId);
  const commitSha = optionalText(release.commitSha);
  const treeSha = optionalText(release.treeSha);
  const skillMdSha = optionalText(release.skillMdSha);
  if (!releaseId || !releaseSourceId || !commitSha || !treeSha || !skillMdSha) {
    return metadataOnly("incomplete_release");
  }
  if (
    !shaPattern.test(commitSha)
    || !shaPattern.test(treeSha)
    || !shaPattern.test(skillMdSha)
  ) {
    return metadataOnly("invalid_release");
  }
  if (releaseSourceId !== source.id) {
    return metadataOnly("release_source_mismatch");
  }

  const sourceId = optionalText(source.id);
  const normalizedRoot = optionalText(source.normalizedRoot);
  if (!sourceId) {
    return metadataOnly("source_unavailable");
  }

  let manifestSource: ManifestSource;
  if (source.kind === "catalog") {
    const catalogSkillId = optionalText(source.catalogSkillId);
    const expectedCatalogSkillId = item.kind === "synced"
      ? optionalText(item.syncedIdentity?.catalogSkillId)
      : optionalText(item.catalogSkillId);
    if (
      !catalogSkillId
      || !normalizedRoot
      || !expectedCatalogSkillId
      || expectedCatalogSkillId.toLowerCase() !== catalogSkillId.toLowerCase()
    ) {
      return metadataOnly("source_mismatch");
    }
    manifestSource = {
      id: sourceId,
      kind: "catalog",
      catalogSkillId,
      normalizedRoot
    };
  } else if (source.kind === "public_github") {
    if (item.kind === "catalog") {
      return metadataOnly("source_mismatch");
    }
    const repositoryId = optionalText(source.repositoryId);
    const repositorySlug = optionalText(source.repositorySlug);
    if (!repositoryId || !repositorySlug || !normalizedRoot) {
      return metadataOnly("source_mismatch");
    }
    manifestSource = {
      id: sourceId,
      kind: "public_github",
      repositoryId,
      repositorySlug,
      normalizedRoot
    };
  } else if (source.kind === "private_github") {
    if (item.kind === "catalog") {
      return metadataOnly("source_mismatch");
    }
    const repositoryId = optionalText(source.repositoryId);
    const repositorySlug = optionalText(source.repositorySlug);
    if (!repositoryId || !repositorySlug || !normalizedRoot) {
      return metadataOnly("source_mismatch");
    }
    manifestSource = { id: sourceId, kind: "private_github" };
  } else {
    return metadataOnly("source_mismatch");
  }

  return {
    status: "installable",
    source: manifestSource,
    release: {
      id: releaseId,
      commitSha,
      treeSha,
      skillMdSha
    }
  };
}

export function buildGroupManifest(input: GroupManifestInput): GroupManifest {
  const revision = input.group.revision;
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error("group revision must be a positive integer");
  }

  const items = [...input.items]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((item, position): GroupManifestItem => {
      if (!Number.isInteger(item.position) || item.position < 0) {
        throw new Error("item position must be a non-negative integer");
      }
      return {
        id: requireText(item.id, "item id"),
        kind: requireItemKind(item.kind),
        position,
        name: requireText(item.name, "item name"),
        description: optionalText(item.description),
        note: optionalText(item.note),
        installability: normalizeInstallability(item)
      };
    });

  return {
    type: GROUP_MANIFEST_TYPE,
    version: GROUP_MANIFEST_VERSION,
    group: {
      id: requireText(input.group.id, "group id"),
      name: requireText(input.group.name, "group name"),
      description: optionalText(input.group.description),
      slug: requireText(input.group.slug, "group slug"),
      revision,
    },
    items
  };
}

export function serializeGroupManifest(input: GroupManifestInput): string {
  return `${JSON.stringify(buildGroupManifest(input), null, 2)}\n`;
}
