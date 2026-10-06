import type { ReactNode } from "react";
import type { PortalSet, LoadState } from "../model";
import type { SkillDisplay } from "./model";

export type UnifiedManagement = {
  busy: boolean;
  blocked: boolean;
  notice: string;
  create: (skills?: SkillDisplay[]) => void;
  add: (skills: SkillDisplay[], set?: PortalSet) => void;
  favorite: (skill: SkillDisplay) => void;
  rename: (set: PortalSet) => void;
  remove: (set: PortalSet, skill: SkillDisplay) => void;
  dialog: (theme: string) => ReactNode;
  detail: { set: PortalSet | null; state: LoadState; error: string; retry: () => void };
};
