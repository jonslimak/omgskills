import {
  groupSyncedSkills,
  type GroupedSyncedSkill,
  type SyncedSkill,
} from "../../synced-skill-grouping";
import { isMember, type PortalData, type PortalSet } from "../model";
import { validPublicSort, publicPageRequest, type PublicSort } from "./public-paging";
import { discoveryCategories } from "./discovery-categories";

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
  skillMDPath?: string;
  hasPinnedInstall?: boolean;
  /** Manual install command from the full catalog record (list summaries omit it). */
  installCommand?: string;
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
  setItemKind?: PortalSet["items"][number]["kind"];
};

export function inventorySummary(skill: SyncedSkill) {
  if (skill.inventoryVersion !== 2 && skill.inventoryVersion !== 3) return null;
  const location = `${skill.deviceName || "Unknown Mac"} / ${skill.source}`;
  if (skill.inventoryVersion === 3) {
    const source = skill.source.toLowerCase() === "claude code" ? "claude" : skill.source.toLowerCase();
    const coverage = skill.scanCoverage?.find(root => root.source === source);
    const reportTime = Date.parse(skill.lastReportedAt ?? "");
    const observedInLatestReport = Number.isFinite(reportTime) && Date.parse(skill.lastSeenAt) >= reportTime;
    const latest = coverage?.state === "complete"
      ? observedInLatestReport ? "Seen on last scan" : "Last known - not observed in latest report"
      : coverage ? "Last known - scan incomplete" : "Last known - scan coverage unknown";
    const status = skill.isCurrent === false ? "Not found on last scan" : latest;
    const observed = Number.isFinite(Date.parse(skill.lastSeenAt))
      ? `Last seen ${new Date(skill.lastSeenAt).toLocaleString()}` : "Last seen time unknown";
    const device = skill.deviceStatus && skill.deviceStatus !== "active" ? ` (${skill.deviceStatus})` : "";
    const reported = skill.lastReportedAt ? `Latest report ${new Date(skill.lastReportedAt).toLocaleString()}` : "No report time";
    const coverageLabel = coverage?.state === "complete" ? "Latest scan coverage complete"
      : coverage ? "Latest scan incomplete" : "Latest scan coverage unknown";
    return { location, report: `${status}${device} - ${observed}`, latestReport: `${coverageLabel} - ${reported}` };
  }
  const time = skill.lastReportedAt ?? skill.lastSeenAt;
  const reported = Number.isFinite(Date.parse(time)) ? `Last reported ${new Date(time).toLocaleString()}` : "Report time unknown";
  const state = skill.deviceStatus && skill.deviceStatus !== "active" ? `Last known (${skill.deviceStatus})` : "Last known";
  return { location, report: `${state} - ${reported}`, latestReport: undefined };
}

export function inventoryCoverageSummary(coverage: GroupedSyncedSkill["scanCoverage"]) {
  if (!coverage) return "Scan coverage unknown";
  return coverage.every(root => root.state === "complete") ? "Scan coverage complete" : "Scan incomplete";
}
export type CollectionDisplay = {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  skillIds: string[];
  authors?: { handle: string; avatar: string }[];
};
export type CreatorDisplay = {
  handle: string;
  name: string;
  tagline: string;
  avatar?: string;
  isCompany?: boolean;
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
  | "data"
  | "developers"
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
  "data",
  "developers",
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
  sort?: PublicSort;
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
export function openSkillNavigation(nav: Navigation, skill: SkillDisplay): Navigation {
  if (!isDiscovery(nav.view) && skill.key.startsWith("catalog:")) {
    if (skill.installed) return { ...nav, selected: `synced:${skill.installed.id}` };
    // Public detail requests must not inherit a private set, search, or source.
    return { ...initialNavigation, view: "discover", selected: skill.key };
  }
  return { ...nav, selected: skill.key };
}
export function parseNavigation(search: string): Navigation {
  const params = new URLSearchParams(search);
  const view = params.get("view") as View;
  const nav: Navigation = {
    view: views.includes(view) ? view : "all",
    id: params.get("id") || "",
    query: params.get("q") || "",
    selected: params.get("skill") || "",
    source: params.get("source") || "all",
  };
  if (nav.view === "category") {
    const term = discoveryCategories.some(group => group.items.includes(nav.id)) ? nav.id : "";
    nav.view = "discover";
    nav.query ||= term;
    nav.id = "";
  }
  if (nav.view === "creators" && nav.id !== "companies") nav.id = "";
  const sort = params.get("sort");
  if (validPublicSort(sort) && sort !== "relevance" && publicPageRequest(nav)?.name !== "list_trending" && publicPageRequest(nav)) nav.sort = sort;
  return nav;
}
function addressSort(nav: Navigation) {
  return nav.sort && nav.sort !== "relevance" && publicPageRequest(nav)?.name !== "list_trending" && publicPageRequest(nav)
    ? nav.sort : undefined;
}
export function navigationSearch(nav: Navigation) {
  const params = new URLSearchParams();
  params.set("view", nav.view);
  if (nav.id) params.set("id", nav.id);
  if (nav.query) params.set("q", nav.query);
  if (nav.selected) params.set("skill", nav.selected);
  if (nav.source !== "all") params.set("source", nav.source);
  const sort = addressSort(nav);
  if (sort) params.set("sort", sort);
  return params.size ? `?${params}` : "";
}

// Clean public addresses (urls.md U-02), relative to the app base. Private views,
// private selections and anything that cannot round-trip keep the ?view= form.
const librarySections = { top: "trending", data: "data", collections: "collections", creators: "creators" } as const;
export const reservedLibraryNames = new Set(["trending", "companies", "creators", "collections", "data", "categories", "me", "library", "search"]);

function pathSegment(value: string) {
  return value && value !== "." && value !== ".." ? encodeURIComponent(value) : null;
}
function ownerSegment(owner: string) {
  return reservedLibraryNames.has(owner.toLowerCase()) ? null : pathSegment(owner);
}

/** `owner/repo:skill/path` <-> `library/owner/repo/skill/path/`; `owner/repo` has no skill part. */
export function catalogSkillPath(id: string): string | null {
  const colon = id.indexOf(":");
  const [owner = "", repo = "", ...extra] = (colon < 0 ? id : id.slice(0, colon)).split("/");
  const skill = colon < 0 ? [] : id.slice(colon + 1).split("/");
  if (extra.length || (colon >= 0 && !id.slice(colon + 1))) return null;
  const segments = [ownerSegment(owner), pathSegment(repo), ...skill.map(pathSegment)];
  return segments.every(Boolean) ? `library/${segments.join("/")}/` : null;
}
function catalogIdFromSegments([owner, repo, ...skill]: string[]) {
  return skill.length ? `${owner}/${repo}:${skill.join("/")}` : `${owner}/${repo}`;
}

export function publicNavigationPath(nav: Navigation): string | null {
  if (!isDiscovery(nav.view) || nav.source !== "all") return null;
  if (nav.selected) return nav.selected.startsWith("catalog:") ? catalogSkillPath(nav.selected.slice(8)) : null;
  if (nav.query && nav.view !== "discover") return null;
  let path: string | null = null;
  if (nav.view === "developers") return nav.id || nav.query ? null : "developers/";
  if (nav.view === "discover") path = nav.id ? null : "library/";
  else if (nav.view === "creators") path = nav.id === "companies" ? "library/companies/" : nav.id ? null : "library/creators/";
  else if (nav.view === "top" || nav.view === "data" || nav.view === "collections") path = nav.id ? null : `library/${librarySections[nav.view]}/`;
  else if (nav.view === "collection") path = pathSegment(nav.id) && `library/collections/${pathSegment(nav.id)}/`;
  else if (nav.view === "creator") path = ownerSegment(nav.id) && `library/${ownerSegment(nav.id)}/`;
  if (!path) return null;
  const params = new URLSearchParams();
  if (nav.query) params.set("q", nav.query);
  const sort = addressSort(nav);
  if (sort) params.set("sort", sort);
  return params.size ? `${path}?${params}` : path;
}

export function parsePublicNavigationPath(relative: string, search: string): Navigation | null {
  if (relative === "developers" || relative === "developers/") return { ...initialNavigation, view: "developers" };
  if (relative !== "library" && !relative.startsWith("library/")) return null;
  const parts = relative.slice("library".length).replace(/^\//, "").replace(/\/$/, "");
  let segments: string[];
  try { segments = parts ? parts.split("/").map(decodeURIComponent) : []; } catch { return null; }
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  const params = new URLSearchParams(search);
  const base = { ...initialNavigation, view: "discover" as View };
  let nav: Navigation | null = null;
  const [first = "", second] = segments;
  if (!segments.length) nav = { ...base, query: params.get("q") || "" };
  else if (segments.length === 1 && first === "trending") nav = { ...base, view: "top" };
  else if (segments.length === 1 && first === "companies") nav = { ...base, view: "creators", id: "companies" };
  else if (segments.length === 1 && (first === "data" || first === "collections" || first === "creators")) nav = { ...base, view: first };
  else if (segments.length === 2 && first === "collections") nav = { ...base, view: "collection", id: second! };
  else if (!reservedLibraryNames.has(first.toLowerCase())) {
    // A direct skill address opens its creator's list with that skill selected.
    nav = segments.length === 1 ? { ...base, view: "creator", id: first }
      : { ...base, view: "creator", id: first.toLowerCase(), selected: `catalog:${catalogIdFromSegments(segments)}` };
  }
  if (!nav) return null;
  const sort = params.get("sort");
  if (!nav.selected && validPublicSort(sort) && sort !== "relevance" && publicPageRequest(nav)?.name !== "list_trending" && publicPageRequest(nav)) nav.sort = sort;
  return nav;
}

/** The address after the app base: a clean public path when enabled and possible, otherwise `?view=`. */
export function navigationLocation(nav: Navigation, cleanPaths: boolean) {
  return (cleanPaths && publicNavigationPath(nav)) || navigationSearch(nav);
}
export function isDiscovery(view: View) {
  return [
    "discover",
    "data",
    "developers",
    "top",
    "creators",
    "collections",
    "creator",
    "collection",
    "category",
  ].includes(view);
}
// Catalog IDs start with the GitHub owner, so linked skills outside the loaded catalog page keep an author.
function catalogOwner(id: string | null | undefined) {
  const owner = id?.split("/")[0] ?? "";
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(owner) && id!.includes("/") ? owner : "";
}

export function skillDisplays(data: PortalData, catalog: CatalogDisplay) {
  const grouped = groupSyncedSkills(data.skills, { groupInstallations: true });
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
      author: publicSkill?.author || catalogOwner(skill.catalogSkillId),
      avatar: publicSkill?.avatar || (catalogOwner(skill.catalogSkillId)
        ? `https://github.com/${encodeURIComponent(catalogOwner(skill.catalogSkillId))}.png?size=80` : undefined),
      githubUrl: skill.githubUrl,
      stars: publicSkill?.stars,
      tags: publicSkill?.tags || [],
      installCommand: publicSkill?.installCommand,
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
export function setSkillDisplays(set: PortalSet, mine: SkillDisplay[], catalog: CatalogSummary[] = []): SkillDisplay[] {
  const byId = new Map(catalog.map(skill => [skill.id, skill]));
  return set.items.map(item => {
    const installed = item.syncedSkillId
      ? mine.find(skill => skill.installed?.allSkillIds.includes(item.syncedSkillId!))
      : item.catalogSkillId ? mine.find(skill => skill.catalogId === item.catalogSkillId) : undefined;
    const publicSkill = item.kind === "catalog" && item.catalogSkillId ? byId.get(item.catalogSkillId) : undefined;
    const installation = installed?.installed?.sourceSkills.find(skill => skill.id === item.syncedSkillId);
    return { key: `set-item:${item.id}`, setItemId: item.id, setItemKind: item.kind, name: publicSkill?.name || item.name,
      catalogId: item.catalogSkillId ?? undefined,
      description: publicSkill?.description || item.description || installed?.description || "",
      githubUrl: publicSkill?.githubUrl || item.githubUrl || installed?.githubUrl || null,
      author: publicSkill?.author || installed?.author || "", tags: publicSkill?.tags || [],
      avatar: publicSkill?.avatar || installed?.avatar, stars: publicSkill?.stars, installCommand: publicSkill?.installCommand,
      installed: installation && (installation.inventoryVersion === 2 || installation.inventoryVersion === 3 || installation.deviceId != null)
        ? groupSyncedSkills([installation])[0] : installed?.installed };
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

export function discoverCollectionPage(collections: CatalogDisplay["collections"], requestedIndex: number) {
  const size = 3;
  const lastIndex = Math.max(0, Math.ceil(collections.length / size) - 1);
  const index = Math.max(0, Math.min(requestedIndex, lastIndex));
  const offset = index * size;
  return {
    index,
    lastIndex,
    items: collections.slice(offset, offset + size),
    start: collections.length ? offset + 1 : 0,
    end: Math.min(offset + size, collections.length),
  };
}
