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

export type SavedVersions = { key: string; versions: { id: string; savedAt: string }[] };
export type SavedVersionsLoader = (keys: string[], signal: AbortSignal) => Promise<SavedVersions | null>;

/** A saved skill's versions, newest first, for the first of these keys that is saved; null when none is. */
export async function loadSavedVersions(api: PortalApi, keys: string[], signal: AbortSignal): Promise<SavedVersions | null> {
  // A skill's copies may be saved under several folder names; show the one with the most history.
  let best: SavedVersions | null = null;
  for (const key of keys) {
    try {
      const { versions } = await api<{ versions: { id: string; savedAt: string }[] }>(
        `${base}/skills/${encodeURIComponent(key)}/versions`, { signal, cache: "no-store" });
      if (!best || versions.length > best.versions.length) best = { key, versions: versions.map(({ id, savedAt }) => ({ id, savedAt })) };
    } catch (error) {
      if (error instanceof PortalApiError && (error.status === 404 || error.status === 503)) continue;
      throw error;
    }
  }
  return best;
}

/** Opens the Mac app, which asks first and then puts this saved version in place of the skill's copies. */
export function restoreVersionLink(name: string, key: string, versionId: string) {
  return `omgskills://restore?name=${encodeURIComponent(name.trim())}&key=${encodeURIComponent(key)}&version=${encodeURIComponent(versionId)}`;
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
  status: "saved" | "deleted" | "review" | "confirmed" | "excluded" | "library" | "set" | "waiting" | "off"
    | "links" | "too_large" | "unreadable" | "failed";
  versionCount: number;
  setCount: number;
  savedAt: string | null;
  labels: CloudLabel[];
  findings: { path: string; findings: CloudFinding[] }[];
  /** Installed on one of your Macs now, as opposed to kept only in the cloud. */
  onMac: boolean;
};

/**
 * One row per skill: every skill seen on a Mac, plus any saved skill no longer there.
 * Library and Set installs aren't uploaded while unchanged, since they can be fetched again.
 * A Mac's own reason for not saving a skill wins over guessing from the inventory.
 */
export function cloudSkillRows(state: CloudSaveState, installed: SyncedSkill[]): CloudSkillRow[] {
  const names = new Map<string, string>();
  const fromLibrary = new Set<string>();
  const fromCatalog = new Set<string>();
  for (const skill of installed) {
    if (skill.isCurrent === false) continue;
    const key = cloudSkillKey(skill.installationFolder || skill.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, skill.name);
    if (skill.catalogSkillId || skill.installedFromSet) fromLibrary.add(key);
    if (skill.catalogSkillId) fromCatalog.add(key);
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
    const found: CloudSkillRow["status"] = excluded.has(key) ? "excluded"
      : review ? (review.confirmed ? "confirmed" : "review")
      : copy ? (copy.deletedLocallyAt ? "deleted" : "saved")
      : !state.settings.enabled ? (fromLibrary.has(key) ? "library" : "off")
      : state.skipped[key] ?? (fromLibrary.has(key) ? "library" : "waiting");
    // A private skill installed from a Set isn't in the library; say where it came from.
    const status = found === "library" && fromLibrary.has(key) && !fromCatalog.has(key) ? "set" : found;
    return {
      key,
      name: label(key),
      status,
      versionCount: copy?.versionCount ?? 0,
      setCount: copy?.setCount ?? 0,
      savedAt: copy?.currentVersion.savedAt ?? null,
      labels: copy?.currentVersion.labels ?? [],
      findings: review?.files ?? [],
      onMac: names.has(key),
    };
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
}

const statusOrder: Record<CloudSkillRow["status"], number> = {
  review: 0, confirmed: 1, saved: 2, deleted: 3, failed: 4, links: 5, too_large: 6, unreadable: 7, waiting: 8, off: 9,
  library: 10, set: 10, excluded: 11,
};

export const statusText: Record<CloudSkillRow["status"], string> = {
  saved: "Saved",
  deleted: "Saved · deleted on Mac",
  review: "Needs review",
  confirmed: "Saving on next sync",
  excluded: "Left out",
  library: "Saved · from the library",
  set: "Saved · from a Set",
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

/**
 * One line for every screen: all your skills (on your Macs or kept in the cloud), then only what
 * needs a look. The cloud keeps a record of every skill, so a skill whose files need attention still counts.
 */
export function cloudSummaryText(rows: CloudSkillRow[]) {
  const count = (test: (row: CloudSkillRow) => boolean) => rows.filter(test).length;
  const attention = count(row => needsAttention(row.status));
  const pending = count(row => row.status === "waiting" || row.status === "confirmed");
  const leftOut = count(row => row.status === "excluded");
  const notOnMac = count(row => !row.onMac);
  const parts = [`${rows.length} ${rows.length === 1 ? "skill" : "skills"}`];
  if (!attention && !pending && !leftOut) parts.push("all saved");
  if (attention) parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  if (pending) parts.push(`${pending} not saved yet`);
  if (leftOut) parts.push(`${leftOut} left out`);
  if (notOnMac) parts.push(`${notOnMac} not on your Macs`);
  return parts.join(" · ");
}

/** Skills cloud save can't keep a copy of until something is done about them. */
export function needsAttention(status: CloudSkillRow["status"]) {
  return status === "review" || status === "failed" || status === "links" || status === "too_large" || status === "unreadable";
}

/** One status for a skill whose copies sit in several folders: the one that needs attention first. */
export function skillCloudRow(rows: Map<string, CloudSkillRow>, keys: string[]): CloudSkillRow | null {
  let best: CloudSkillRow | null = null;
  for (const key of keys) {
    const row = rows.get(key);
    if (!row) continue;
    const rank = (item: CloudSkillRow) => (needsAttention(item.status) ? 0 : 100) + statusOrder[item.status];
    if (!best || rank(row) < rank(best)) best = row;
  }
  return best;
}

/** What to do about a skill that isn't saved, for its detail panel. */
export const statusHelp: Partial<Record<CloudSkillRow["status"], string>> = {
  review: "A file looks like it contains a key or password, so it wasn't saved. Remove the key on your Mac and it saves by itself, or confirm it's safe.",
  confirmed: "You confirmed it's safe. Your Mac saves it on its next sync.",
  links: "It links to files outside its folder, which are never saved. Copy those files into the skill and it saves by itself.",
  too_large: "It's over the size limit (12 MB, 4 MB per file).",
  unreadable: "Your Mac couldn't read its folder.",
  failed: "The last save failed. Your Mac tries again on its next sync.",
  library: "Unchanged from the library, so the library keeps it for you. If you change it, your version is saved too.",
  set: "Unchanged from the Set you installed it from, so the Set keeps it for you. If you change it, your version is saved too.",
  excluded: "You left it out of cloud save.",
  waiting: "Your Mac saves it on its next sync.",
  off: "Cloud save is off.",
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
