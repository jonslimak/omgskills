import { existsSync, readFileSync } from "node:fs";
import type { Skill } from "../types.js";
import { pinnedPackageMetadataFromSkill } from "./package-metadata.js";
import type {
  PinnedPackageMetadataOverlay,
  PinnedPackageMetadataOverlayEntry,
  ShadowCadence,
} from "./types.js";

function sortEntries(entries: PinnedPackageMetadataOverlayEntry[]): PinnedPackageMetadataOverlayEntry[] {
  return entries.slice().sort((left, right) => left.id.localeCompare(right.id));
}

export function loadPinnedPackageMetadataOverlay(path: string): PinnedPackageMetadataOverlay | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PinnedPackageMetadataOverlay;
}

export function shouldReadPinnedPackageMetadataOverlay(cadence: ShadowCadence): boolean {
  return cadence === "fast" || cadence === "combined";
}

export function shouldWritePinnedPackageMetadataOverlay(cadence: ShadowCadence): boolean {
  return cadence === "combined";
}

export function applyPinnedPackageMetadataOverlay<T extends Skill>(
  cadence: ShadowCadence,
  skills: T[],
  overlay: PinnedPackageMetadataOverlay | null,
): { skills: T[]; overlayLoaded: boolean; overlayEntryCount: number; appliedCount: number } {
  if (!shouldReadPinnedPackageMetadataOverlay(cadence) || !overlay) {
    return { skills, overlayLoaded: false, overlayEntryCount: 0, appliedCount: 0 };
  }

  const entryById = new Map(overlay.entries.map((entry) => [entry.id, entry]));
  let appliedCount = 0;
  const merged = skills.map((skill) => {
    const entry = entryById.get(skill.id);
    if (!entry) return skill;
    const { id: _id, ...metadata } = entry;
    appliedCount += 1;
    return { ...skill, ...metadata };
  });
  return {
    skills: merged,
    overlayLoaded: true,
    overlayEntryCount: overlay.entryCount,
    appliedCount,
  };
}

export function buildPinnedPackageMetadataOverlay(
  skills: Skill[],
  generatedAt: string,
): PinnedPackageMetadataOverlay {
  const entries = sortEntries(
    skills.flatMap((skill) => {
      const metadata = pinnedPackageMetadataFromSkill(skill);
      return metadata ? [{ id: skill.id, ...metadata }] : [];
    }),
  );
  return { generatedAt, entryCount: entries.length, entries };
}
