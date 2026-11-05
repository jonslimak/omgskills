import type { CloudSaveState } from "../../cloud-save/cloud-save";
import { cloudSkillKey } from "../../cloud-save/cloud-save";
import type { SyncedSkill } from "../../synced-skill-grouping";

/** Sample cloud save state for the preview: one skill to review, three that can't be saved, the rest saved. */
export function previewCloudState(skills: SyncedSkill[]): CloudSaveState {
  const own = [...new Set(skills.filter(skill => skill.isCurrent !== false && !skill.catalogSkillId && !skill.installedFromSet)
    .map(skill => cloudSkillKey(skill.installationFolder || skill.name)))];
  const [review, ...rest] = own;
  const reasons = ["links", "links", "too_large"] as const;
  const skipped = Object.fromEntries(rest.slice(0, reasons.length).map((key, index) => [key, reasons[index]]));
  const saved = rest.slice(reasons.length);
  return {
    settings: { enabled: true, excludedSkillKeys: [] },
    usage: { bytes: 6_800_000, limitBytes: 1024 ** 3 },
    skills: saved.map((key, index) => ({ key, versionCount: 1 + (index % 3), deletedLocallyAt: null,
      currentVersion: { id: `v-${key}`, savedAt: "2026-11-03T10:00:00Z", fileCount: 3, totalBytes: 12_000,
        labels: index % 4 === 0 ? ["scripts" as const] : [] } })),
    needsReview: review ? [{ key: review, confirmed: false, updatedAt: "2026-11-05T10:00:00Z",
      files: [{ path: "rules/1-safety.md", findings: [{ rule: "password", kind: "Password", line: 580 }] }] }] : [],
    skipped,
  };
}
