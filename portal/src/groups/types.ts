export type GroupVisibility = "public" | "restricted" | "private";

export type SkillGroup = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  visibility?: GroupVisibility;
  isFavorites?: boolean;
  disabledAt?: string | null;
  itemCount: number;
  allowedEmailCount?: number;
  allowedEmails?: { id: string; email: string }[];
  ownerDisplayName?: string;
  appDeepLink?: string | null;
  syncedSkillIds?: string[];
};

export type SkillGroupItem = {
  id: string;
  syncedSkillId?: string | null;
  catalogSkillId?: string | null;
  kind: string;
  name: string;
  description: string;
  githubUrl: string | null;
  source: string;
  position: number;
  cloudShared?: boolean;
  /** Private items: the version invitees install; its instructions can be read on the web. */
  sharedReleaseId?: string;
  updateAvailable?: boolean;
};

export type SkillGroupDetail = SkillGroup & {
  accessRole: "owner" | "invited" | "public";
};

export type GroupProfile = {
  handle: string | null;
};
