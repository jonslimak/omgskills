import { PortalApiError } from "../api-error";
import type { PortalApi } from "../portal-api";
import type { SyncedSkill } from "../synced-skill-grouping";

export type CloudFinding = { rule: string; kind: string; line: number };
export type CloudLabel = "scripts" | "download_and_run" | "invisible_characters" | "hidden_instructions" | "confirmed_secret";

export type CloudSaveState = {
  settings: { enabled: boolean; excludedSkillKeys: string[] };
  usage: { bytes: number; limitBytes: number };
  skills: {
    key: string;
    versionCount: number;
    deletedLocallyAt: string | null;
    /** Sets that share this skill; older servers leave it out. */
    setCount?: number;
    currentVersion: { id: string; savedAt: string; fileCount: number; totalBytes: number; labels?: CloudLabel[] };
  }[];
  needsReview: { key: string; files: { path: string; findings: CloudFinding[] }[]; confirmed: boolean; updatedAt: string }[];
  /** Why a Mac didn't save each skill on its last pass. */
  skipped: Record<string, CloudSkipReason>;
};

export type CloudSkipReason = "library" | "links" | "too_large" | "unreadable" | "failed";

export type CloudSaveView =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; state: CloudSaveState };

const base = "/api/portal/cloud-save";

export async function loadCloudSave(api: PortalApi, signal?: AbortSignal): Promise<CloudSaveView> {
  try {
    const state = await api<CloudSaveState>(base, { signal, cache: "no-store" });
    return { status: "ready", state: { ...state, needsReview: state.needsReview ?? [], skipped: state.skipped ?? {} } };
  } catch (error) {
    if (error instanceof PortalApiError && error.status === 503) return { status: "unavailable" };
    throw error;
  }
}

export function saveCloudSettings(api: PortalApi, update: { enabled?: boolean; excludedSkillKeys?: string[] }) {
  return api<{ settings: CloudSaveState["settings"] }>(`${base}/settings`, { method: "PUT", body: JSON.stringify(update) });
}

export type CloudDeleteResult = { deletedSkills: number; freedBytes: number; pendingFiles: number };

/** Deletes one saved skill and stops saving it, or, with no key, everything saved and turns cloud save off. */
export function deleteCloudSaved(api: PortalApi, key?: string) {
  return api<CloudDeleteResult>(key === undefined ? base : `${base}/skills/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export type SavedSkillMd = { key: string; markdown: string; truncated: boolean; savedAt: string };
export type SavedSkillMdLoader = (keys: string[], signal: AbortSignal) => Promise<SavedSkillMd | null>;

export type SharedSkillMd = { markdown: string; truncated: boolean };
export type SharedSkillMdLoader = (releaseId: string, signal: AbortSignal) => Promise<SharedSkillMd>;

/** A private Set item's instructions, for people the Set is shared with (checked like the Mac download). */
/** Not cached: every open asks the server again, so taking away access (or marking a version secret) applies at once. */
export function loadSharedSkillMd(api: PortalApi, releaseId: string, signal: AbortSignal): Promise<SharedSkillMd> {
  return api<SharedSkillMd>(`/api/portal/private-releases/${encodeURIComponent(releaseId)}/skill-md`, { signal, cache: "no-store" });
}

/** The first of these skill keys with a saved copy, or null when none is saved. */
export async function loadSavedSkillMd(api: PortalApi, keys: string[], signal: AbortSignal): Promise<SavedSkillMd | null> {
  for (const key of keys) {
    try {
      return await api<SavedSkillMd>(`${base}/skills/${encodeURIComponent(key)}/skill-md`, { signal, cache: "no-store" });
    } catch (error) {
      if (error instanceof PortalApiError && (error.status === 404 || error.status === 503)) continue;
      throw error;
    }
  }
  return null;
}

export function confirmCloudReview(api: PortalApi, key: string) {
  return api(`${base}/skills/${encodeURIComponent(key)}/review`, { method: "POST", body: JSON.stringify({ confirm: true }) });
}

/** A skill's identity across agents and Macs, matching the server and the Mac: the folder name, NFC and lower case, untrimmed. */
export function cloudSkillKey(name: string) {
  return name.normalize("NFC").toLowerCase();
}

export type CloudDeleteSelection = { kind: "skill"; key: string } | { kind: "all" } | null;

export function isDeletingCloudSkill(selection: CloudDeleteSelection, key: string): boolean {
  return selection?.kind === "skill" && selection.key === key;
}

export function isDeletingAllCloudSkills(selection: CloudDeleteSelection): boolean {
  return selection?.kind === "all";
}

export type CloudSkillRow = {
  key: string;
  name: string;
  status: "saved" | "deleted" | "review" | "confirmed" | "excluded" | "library" | "waiting" | "off"
    | "links" | "too_large" | "unreadable" | "failed";
  versionCount: number;
  setCount: number;
  savedAt: string | null;
  labels: CloudLabel[];
  findings: { path: string; findings: CloudFinding[] }[];
};

/**
 * One row per skill: every skill seen on a Mac, plus any saved skill no longer there.
 * Library and Set installs aren't uploaded while unchanged, since they can be fetched again.
 * A Mac's own reason for not saving a skill wins over guessing from the inventory.
 */
export function cloudSkillRows(state: CloudSaveState, installed: SyncedSkill[]): CloudSkillRow[] {
  const names = new Map<string, string>();
  const fromLibrary = new Set<string>();
  for (const skill of installed) {
    if (skill.isCurrent === false) continue;
    const key = cloudSkillKey(skill.installationFolder || skill.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, skill.name);
    if (skill.catalogSkillId || skill.installedFromSet) fromLibrary.add(key);
  }
  const saved = new Map(state.skills.map(skill => [skill.key, skill]));
  const reviews = new Map(state.needsReview.map(review => [review.key, review]));
  const excluded = new Set(state.settings.excludedSkillKeys);
  const keys = [...new Set([...names.keys(), ...saved.keys(), ...reviews.keys()])];
  // Two folders can hold skills with the same name; they're saved apart, so say which folder is which.
  const nameCounts = new Map<string, number>();
  for (const key of keys) {
    const name = names.get(key) ?? key;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const label = (key: string) => {
    const name = names.get(key) ?? key;
    return (nameCounts.get(name) ?? 0) > 1 && cloudSkillKey(name) !== key ? `${name} (folder ${key})` : name;
  };
  return keys.map((key): CloudSkillRow => {
    const copy = saved.get(key);
    const review = reviews.get(key);
    const status: CloudSkillRow["status"] = excluded.has(key) ? "excluded"
      : review ? (review.confirmed ? "confirmed" : "review")
      : copy ? (copy.deletedLocallyAt ? "deleted" : "saved")
      : !state.settings.enabled ? (fromLibrary.has(key) ? "library" : "off")
      : state.skipped[key] ?? (fromLibrary.has(key) ? "library" : "waiting");
    return {
      key,
      name: label(key),
      status,
      versionCount: copy?.versionCount ?? 0,
      setCount: copy?.setCount ?? 0,
      savedAt: copy?.currentVersion.savedAt ?? null,
      labels: copy?.currentVersion.labels ?? [],
      findings: review?.files ?? [],
    };
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
}

const statusOrder: Record<CloudSkillRow["status"], number> = {
  review: 0, confirmed: 1, saved: 2, deleted: 3, failed: 4, links: 5, too_large: 6, unreadable: 7, waiting: 8, off: 9,
  library: 10, excluded: 11,
};

export const statusText: Record<CloudSkillRow["status"], string> = {
  saved: "Saved",
  deleted: "Saved · deleted on Mac",
  review: "Needs review",
  confirmed: "Saving on next sync",
  excluded: "Left out",
  library: "From the library, not uploaded",
  waiting: "Not saved yet",
  off: "Not saved",
  links: "Not saved: links to files outside the skill",
  too_large: "Not saved: too large",
  unreadable: "Not saved: couldn't be read",
  failed: "Not saved yet: the last try failed, trying again",
};

export const labelText: Record<CloudLabel, string> = {
  confirmed_secret: "Contains a key you confirmed",
  download_and_run: "Downloads and runs code",
  hidden_instructions: "Contains hidden instructions",
  invisible_characters: "Contains invisible characters",
  scripts: "Contains scripts",
};

/** What deleting also does to Sets, for the confirmation; empty when no Set shares it. */
export function setsNote(setCount: number) {
  if (setCount <= 0) return "";
  return ` It's also taken out of ${setCount === 1 ? "1 Set" : `${setCount} Sets`}; people keep what they installed.`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
