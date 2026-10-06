import {
  groupSyncedSkills,
  type GroupedSyncedSkill,
} from "../../synced-skill-grouping";
import { isMember, type PortalData, type PortalSet } from "../model";

// Presentation fields only; the stored skill and group models stay unchanged.
export function setAccessSummary(set: PortalSet) {
  const emails = set.visibility === "restricted" && set.role === "owner"
    ? set.allowedEmails?.map(entry => entry.email) : undefined;
  return {
    people: [set.ownerName || "Owner", ...(emails ?? [])],
    label: set.visibility === "public" ? "Public access"
      : set.visibility === "private" ? "Only you"
      : emails ? `${emails.length} ${emails.length === 1 ? "email" : "emails"} with access` : "Invite only",
  };
}

export type CatalogSummary = {
  id: string;
  name: string;
  description: string;
  author: string;
  avatar?: string;
  githubUrl: string;
  stars?: number;
  tags: string[];
  publicUrl?: string;
};
export type SkillDisplay = Omit<CatalogSummary, "id" | "githubUrl"> & {
  key: string;
  catalogId?: string;
  githubUrl: string | null;
  installed?: GroupedSyncedSkill;
  setItemId?: string;
};
export type CollectionDisplay = {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  authors?: { handle: string; avatar: string }[];
};
export type CreatorDisplay = {
  handle: string;
  name: string;
  tagline: string;
  avatar?: string;
};
export type CatalogDisplay = {
  skills: CatalogSummary[];
  collections: CollectionDisplay[];
  creators: CreatorDisplay[];
  categories: { label: string; items: string[] }[];
  trendingIds: string[];
  resultIds?: string[];
};
export type View =
  | "all"
  | "favorites"
  | "sets"
  | "discover"
  | "top"
  | "creators"
  | "collections"
  | "set"
  | "creator"
  | "collection"
  | "category"
  | "agents"
  | "devices"
  | "profile"
  | "github"
  | "mcp";
const views: View[] = [
  "all",
  "favorites",
  "sets",
  "discover",
  "top",
  "creators",
  "collections",
  "set",
  "creator",
  "collection",
  "category",
  "agents",
  "devices",
  "profile",
  "github",
  "mcp",
];
export type Navigation = {
  view: View;
  id: string;
  query: string;
  selected: string;
  source: string;
};
export const initialNavigation: Navigation = {
  view: "all",
  id: "",
  query: "",
  selected: "",
  source: "all",
};
export function parseNavigation(search: string): Navigation {
  const params = new URLSearchParams(search);
  const view = params.get("view") as View;
  return {
    view: views.includes(view) ? view : "all",
    id: params.get("id") || "",
    query: params.get("q") || "",
    selected: params.get("skill") || "",
    source: params.get("source") || "all",
  };
}
export function navigationSearch(nav: Navigation) {
  const params = new URLSearchParams();
  if (nav.view !== "all") params.set("view", nav.view);
  if (nav.id) params.set("id", nav.id);
  if (nav.query) params.set("q", nav.query);
  if (nav.selected) params.set("skill", nav.selected);
  if (nav.source !== "all") params.set("source", nav.source);
  return params.size ? `?${params}` : "";
}
export function isDiscovery(view: View) {
  return [
    "discover",
    "top",
    "creators",
    "collections",
    "creator",
    "collection",
    "category",
  ].includes(view);
}
export function skillDisplays(data: PortalData, catalog: CatalogDisplay) {
  const grouped = groupSyncedSkills(data.skills);
  const byId = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const mine: SkillDisplay[] = grouped.map((skill) => {
    const publicSkill = skill.catalogSkillId
      ? byId.get(skill.catalogSkillId)
      : undefined;
    return {
      key: `synced:${skill.id}`,
      catalogId: skill.catalogSkillId || undefined,
      name: skill.name,
      description: skill.description || "",
      author: publicSkill?.author || "",
      avatar: publicSkill?.avatar,
      githubUrl: skill.githubUrl,
      stars: publicSkill?.stars,
      tags: publicSkill?.tags || [],
      installed: skill,
    };
  });
  const library: SkillDisplay[] = catalog.skills.map(({ id, ...skill }) => ({
    ...skill,
    key: `catalog:${id}`,
    catalogId: id,
    installed: grouped.find((item) => item.catalogSkillId === id),
  }));
  return { mine, library };
}
export function matchesSearch(skill: SkillDisplay, query: string) {
  const q = query.trim().toLowerCase();
  return `${skill.name} ${skill.description} ${skill.author} ${skill.tags.join(" ")} ${skill.installed?.sourceSkills.map((s) => `${s.name} ${s.description || ""}`).join(" ") || ""}`
    .toLowerCase()
    .includes(q);
}

// Set contents come from the detail response, not the account's installed list.
export function setSkillDisplays(set: PortalSet, mine: SkillDisplay[]): SkillDisplay[] {
  return set.items.map(item => {
    const installed = item.syncedSkillId
      ? mine.find(skill => skill.installed?.allSkillIds.includes(item.syncedSkillId!))
      : item.catalogSkillId ? mine.find(skill => skill.catalogId === item.catalogSkillId) : undefined;
    return { key: `set-item:${item.id}`, setItemId: item.id, name: item.name,
      catalogId: item.catalogSkillId ?? undefined,
      description: item.description, githubUrl: item.githubUrl, author: "", tags: [],
      installed: installed?.installed };
  });
}
export function isFavorite(data: PortalData, skill: SkillDisplay) {
  return data.sets.some(set => set.isFavorites && set.role === "owner" && (
    (skill.installed && isMember(set, skill.installed)) ||
    (skill.catalogId && set.items.some(item => item.kind === "catalog" && item.catalogSkillId === skill.catalogId))
  ));
}
export function starCount(value: number | undefined) {
  if (value === undefined) return "";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function agentKind(source: string): "claude" | "codex" | "other" {
  const name = source.trim().toLowerCase();
  return name === "claude" || name === "claude code" ? "claude" : name === "codex" ? "codex" : "other";
}
