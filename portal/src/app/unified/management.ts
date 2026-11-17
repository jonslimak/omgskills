import type { ReactNode } from "react";
import type { PortalSet, LoadState, Visibility } from "../model";
import type { SkillDisplay } from "./model";

export type UnifiedManagement = {
  busy: boolean;
  blocked: boolean;
  notice: string;
  /** A short confirmation after a skill is added to or removed from a set; `id` changes each time. */
  toast?: { text: string; id: number } | null;
  create: (skills?: SkillDisplay[]) => void;
  /** `choices`: what the Set's skill picker offers (all of My skills, saved ones too); defaults to installed skills. */
  add: (skills: SkillDisplay[], set?: PortalSet, choices?: SkillDisplay[]) => void;
  favorite: (skill: SkillDisplay) => void;
  rename: (set: PortalSet) => void;
  access: (set: PortalSet) => void;
  visibility: (set: PortalSet, visibility: Visibility) => void;
  remove: (set: PortalSet, skill: SkillDisplay) => void;
  reorder: (set: PortalSet, itemId: string, offset: -1 | 1) => void;
  /** Moves a skill shared from cloud save to the owner's newest saved version. */
  updateItem?: (set: PortalSet, itemId: string) => void;
  moderate: (set: PortalSet) => void;
  copyLink: (set: PortalSet) => void;
  /** The companion's Set install link, or null while Mac Set installs are off. */
  installLink?: (set: PortalSet) => string | null;
  dialog: (theme: string) => ReactNode;
  detail: { set: PortalSet | null; state: LoadState; error: string; retry: () => void;
    catalog?: { state: LoadState; note: string; retry: () => void } };
};
