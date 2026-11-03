import assert from "node:assert/strict";
import test from "node:test";
import { portalGroupItem, type PortalGroupItemRow } from "./portal-group-item.js";

const row = (overrides: Partial<PortalGroupItemRow> = {}): PortalGroupItemRow => ({
  id: "item", kind: "synced", syncedSkillId: "synced", catalogSkillId: null, itemGithubUrl: null,
  snapshotName: "notes", snapshotDescription: null, note: null, position: 0, skillName: null,
  skillDescription: null, githubUrl: null, source: "claude", ...overrides,
});

test("a skill shared from cloud save says so, and only its owner hears about a newer version", () => {
  const shared = row({ sourceKind: "cloud", releaseId: "r1", savedReleaseId: "r2" });
  assert.equal(portalGroupItem(shared, "owner").cloudShared, true);
  assert.equal(portalGroupItem(shared, "owner").updateAvailable, true);
  assert.equal(portalGroupItem(shared, "invited").cloudShared, true);
  assert.equal(portalGroupItem(shared, "invited").updateAvailable, undefined);
  assert.equal(portalGroupItem({ ...shared, savedReleaseId: "r1" }, "owner").updateAvailable, undefined);
  assert.equal(portalGroupItem(shared, "public").cloudShared, undefined);
  assert.equal(portalGroupItem(row(), "owner").cloudShared, undefined);
});
