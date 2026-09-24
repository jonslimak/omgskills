import type { GroupedSyncedSkill, SyncedSkill } from "../synced-skill-grouping";

export type Visibility = "public" | "restricted" | "private";
export const visibilityLabels: Record<Visibility, string> = {
  public: "Public",
  restricted: "Invite only",
  private: "Only me",
};
export type SetItem = {
  id: string;
  syncedSkillId: string | null;
  name: string;
  description: string;
  githubUrl: string | null;
  kind: "synced" | "catalog" | "github" | "private-release";
};
export type PortalSet = {
  id: string;
  name: string;
  description: string;
  visibility: Visibility;
  isFavorites: boolean;
  hidden: boolean;
  role: "owner" | "invited" | "public";
  ownerName: string;
  emails: string[];
  items: SetItem[];
  itemCount?: number;
  membershipSkillIds?: string[];
};
export type PortalDevice = {
  id: string;
  name: string;
  lastActive: string;
  status: "active" | "revoked" | "expired";
};
export type PortalData = {
  skills: SyncedSkill[];
  sets: PortalSet[];
  devices: PortalDevice[];
  profile: {
    handle: string;
    email: string;
    name: string;
    published: boolean;
    publicUrl?: string | null;
  };
  privateSourceConnected: boolean | null;
};
export type LoadState = "ready" | "loading" | "error";
export type AccountControls = {
  settings: () => void;
  signOut: () => void;
  busy: boolean;
};
export type PortalActions = {
  updateSet: (
    id: string,
    changes: Partial<
      Pick<
        PortalSet,
        "name" | "description" | "visibility" | "hidden" | "emails" | "items"
      >
    >,
  ) => void;
  createSet: (name: string, skills: GroupedSyncedSkill[]) => void;
  deleteSet: (id: string) => void;
  membership: (
    setId: string,
    skills: GroupedSyncedSkill[],
    add: boolean,
  ) => void;
  revoke: (id: string) => void;
  updateProfile: (changes: Partial<PortalData["profile"]>) => void;
  retry: () => void;
};

export function isMember(set: PortalSet, skill: GroupedSyncedSkill) {
  return (
    set.membershipSkillIds?.some((id) => skill.allSkillIds.includes(id)) ||
    set.items.some(
      (item) =>
        item.syncedSkillId !== null &&
        skill.allSkillIds.includes(item.syncedSkillId),
    )
  );
}
export function filterSkills(
  skills: GroupedSyncedSkill[],
  query: string,
  source: string,
) {
  const q = query.trim().toLowerCase();
  return skills.filter(
    (skill) =>
      (source === "all" || skill.sources.includes(source)) &&
      (!q ||
        skill.sourceSkills.some((member) =>
          `${member.name} ${member.description || ""}`
            .toLowerCase()
            .includes(q),
        )),
  );
}
export function sourceLabel(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com"
      ? parsed.pathname.split("/").filter(Boolean).slice(0, 2).join("/") || null
      : null;
  } catch {
    return null;
  }
}
