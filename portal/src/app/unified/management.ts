import type { ReactNode } from "react";
import type { PortalSet, LoadState, Visibility } from "../model";
import type { SkillDisplay } from "./model";

export type UnifiedManagement = {
  busy: boolean;
  blocked: boolean;
  notice: string;
  create: (skills?: SkillDisplay[]) => void;
  add: (skills: SkillDisplay[], set?: PortalSet) => void;
  favorite: (skill: SkillDisplay) => void;
  rename: (set: PortalSet) => void;
  access: (set: PortalSet) => void;
  visibility: (set: PortalSet, visibility: Visibility) => void;
  remove: (set: PortalSet, skill: SkillDisplay) => void;
  reorder: (set: PortalSet, itemId: string, offset: -1 | 1) => void;
  moderate: (set: PortalSet) => void;
  copyLink: (set: PortalSet) => void;
  dialog: (theme: string) => ReactNode;
  detail: { set: PortalSet | null; state: LoadState; error: string; retry: () => void;
    catalog?: { state: LoadState; note: string; retry: () => void } };
};
