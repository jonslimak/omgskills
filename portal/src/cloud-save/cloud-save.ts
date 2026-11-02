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
    currentVersion: { id: string; savedAt: string; fileCount: number; totalBytes: number; labels?: CloudLabel[] };
  }[];
  needsReview: { key: string; files: { path: string; findings: CloudFinding[] }[]; confirmed: boolean; updatedAt: string }[];
};

export type CloudSaveView =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; state: CloudSaveState };

const base = "/api/portal/cloud-save";

export async function loadCloudSave(api: PortalApi, signal?: AbortSignal): Promise<CloudSaveView> {
  try {
    const state = await api<CloudSaveState>(base, { signal, cache: "no-store" });
    return { status: "ready", state: { ...state, needsReview: state.needsReview ?? [] } };
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
  status: "saved" | "deleted" | "review" | "confirmed" | "excluded" | "library" | "waiting" | "off";
  versionCount: number;
  savedAt: string | null;
  labels: CloudLabel[];
  findings: { path: string; findings: CloudFinding[] }[];
};

/**
 * One row per skill: every skill seen on a Mac, plus any saved skill no longer there.
 * Library and Set installs aren't uploaded while unchanged, since they can be fetched again.
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
  return keys.map((key): CloudSkillRow => {
    const copy = saved.get(key);
    const review = reviews.get(key);
    const status: CloudSkillRow["status"] = excluded.has(key) ? "excluded"
      : review ? (review.confirmed ? "confirmed" : "review")
      : copy ? (copy.deletedLocallyAt ? "deleted" : "saved")
      : fromLibrary.has(key) ? "library"
      : state.settings.enabled ? "waiting" : "off";
    return {
      key,
      name: names.get(key) ?? key,
      status,
      versionCount: copy?.versionCount ?? 0,
      savedAt: copy?.currentVersion.savedAt ?? null,
      labels: copy?.currentVersion.labels ?? [],
      findings: review?.files ?? [],
    };
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
}

const statusOrder: Record<CloudSkillRow["status"], number> = {
  review: 0, confirmed: 1, saved: 2, deleted: 3, waiting: 4, off: 5, library: 6, excluded: 7,
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
};

export const labelText: Record<CloudLabel, string> = {
  confirmed_secret: "Contains a key you confirmed",
  download_and_run: "Downloads and runs code",
  hidden_instructions: "Contains hidden instructions",
  invisible_characters: "Contains invisible characters",
  scripts: "Contains scripts",
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
