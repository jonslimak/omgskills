export type SkillGroup = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  visibility?: string;
  isFavorites?: boolean;
  disabledAt?: string | null;
  itemCount: number;
  allowedEmailCount?: number;
  allowedEmails?: { id: string; email: string }[];
  ownerDisplayName?: string;
  syncedSkillIds?: string[];
};

export type SkillGroupItem = {
  id: string;
  kind: string;
  name: string;
  description: string;
  githubUrl: string | null;
  source: string;
  position: number;
};

export type SkillGroupDetail = SkillGroup & {
  accessRole: "owner" | "invited" | "public";
};

export type GroupProfile = {
  handle: string | null;
};
