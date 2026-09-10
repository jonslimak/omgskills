import type { GroupItemPublication } from "./group-items.js";
import {
  resolveCatalogPublicRelease,
  type PublicReleaseResolverOptions,
} from "./public-releases.js";

export type SyncedGroupPublicationIdentity = {
  id: string;
  identityStatus: string;
  catalogSkillId: string | null;
  skillMdSha: string;
};

export async function prepareSyncedGroupPublication(
  skill: SyncedGroupPublicationIdentity,
  options: PublicReleaseResolverOptions = {},
): Promise<GroupItemPublication> {
  if (skill.identityStatus === "localOnly") {
    return { kind: "metadata_only", reason: "synced_local_only" };
  }
  if (skill.identityStatus === "ambiguous") {
    return { kind: "metadata_only", reason: "synced_ambiguous" };
  }
  if (skill.identityStatus !== "resolved" || !skill.catalogSkillId) {
    return { kind: "metadata_only", reason: "synced_unresolved" };
  }
  return {
    kind: "release",
    ...await resolveCatalogPublicRelease(skill.catalogSkillId, options),
  };
}

export function sameSyncedGroupPublicationIdentity(
  first: SyncedGroupPublicationIdentity,
  second: SyncedGroupPublicationIdentity,
): boolean {
  return first.id === second.id
    && first.identityStatus === second.identityStatus
    && first.catalogSkillId === second.catalogSkillId
    && first.skillMdSha === second.skillMdSha;
}
