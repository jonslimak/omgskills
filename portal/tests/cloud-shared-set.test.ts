import assert from "node:assert/strict";
import test from "node:test";
import { loadSetData } from "../src/integration/data";
import { cloudSharedLabel, setSkillDisplays } from "../src/app/unified/model";
import { cloudSkillRows, setsNote, type CloudSaveState } from "../src/cloud-save/cloud-save";
import { updateMembershipItem } from "../src/integration/membership-data";

const group = { id: "set-1", name: "Team", description: "", visibility: "restricted", isFavorites: false, ownerDisplayName: "Jon" };
const items = [
  { id: "a", kind: "synced", name: "notes", description: "", githubUrl: null, position: 0, cloudShared: true, updateAvailable: true },
  { id: "b", kind: "catalog", catalogSkillId: "owner/repo:pdf", name: "pdf", description: "", githubUrl: null, position: 1 },
];

test("a skill shared from cloud save is marked in the Set; only the owner hears about a newer version", async () => {
  const owner = await loadSetData(async <T>() => ({ group, accessRole: "owner", items }) as T, "set-1");
  assert.equal(owner.items[0].cloudShared, true);
  assert.equal(owner.items[0].updateAvailable, true);
  assert.equal(owner.items[1].cloudShared, undefined);
  const member = await loadSetData(async <T>() => ({ group, accessRole: "invited", items }) as T, "set-1");
  assert.equal(member.items[0].cloudShared, true);
  assert.equal(member.items[0].updateAvailable, undefined);

  const [shared] = setSkillDisplays(owner, []);
  assert.equal(shared.setItemCloudShared, true);
  assert.equal(shared.setItemUpdateAvailable, true);
  assert.equal(cloudSharedLabel(shared, "owner"), "Shared from your cloud save · newer version saved");
  assert.equal(cloudSharedLabel({ ...shared, setItemUpdateAvailable: undefined }, "owner"), "Shared from your cloud save");
  assert.equal(cloudSharedLabel(setSkillDisplays(member, [])[0], "invited"), "Private skill · installs with the Set");
});

test("Update Set calls the item route and checks the answer", async () => {
  const calls: string[] = [];
  await updateMembershipItem(async <T>(path: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${path} ${init?.body}`);
    return { itemId: "a", releaseId: "r2", updated: true } as T;
  }, "set-1", "a", new AbortController().signal);
  assert.deepEqual(calls, ['PATCH /api/portal/groups/set-1/items {"updateItemId":"a"}']);
  await assert.rejects(updateMembershipItem(async <T>() => ({ itemId: "other" }) as T, "set-1", "a", new AbortController().signal));
});

test("deleting a skill shared in Sets says so", () => {
  assert.equal(setsNote(0), "");
  assert.equal(setsNote(1), " It's also taken out of 1 Set; people keep what they installed.");
  assert.equal(setsNote(3), " It's also taken out of 3 Sets; people keep what they installed.");
  const state: CloudSaveState = {
    settings: { enabled: true, excludedSkillKeys: [] }, usage: { bytes: 0, limitBytes: 1 }, needsReview: [], skipped: {},
    skills: [{ key: "notes", versionCount: 1, deletedLocallyAt: null, setCount: 2,
      currentVersion: { id: "r1", savedAt: "2026-11-03T10:00:00Z", fileCount: 1, totalBytes: 1 } }],
  };
  assert.equal(cloudSkillRows(state, [])[0].setCount, 2);
});

test("people a Set is shared with can read a private item's instructions from its version", async () => {
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const shared = [{ ...items[0], sharedReleaseId: releaseId }, { ...items[1], sharedReleaseId: "not an id" }];
  const member = await loadSetData(async <T>() => ({ group, accessRole: "invited", items: shared }) as T, "set-1");
  assert.equal(member.items[0].sharedReleaseId, releaseId);
  assert.equal(member.items[1].sharedReleaseId, undefined, "Only a well-formed version ID is kept");
  const [row] = setSkillDisplays(member, []);
  assert.equal(row.setItemReleaseId, releaseId);
  const paths: string[] = [];
  const { loadSharedSkillMd } = await import("../src/cloud-save/cloud-save");
  await loadSharedSkillMd(async <T>(path: string) => { paths.push(path); return { markdown: "# x", truncated: false } as T; },
    releaseId, new AbortController().signal);
  assert.deepEqual(paths, [`/api/portal/private-releases/${releaseId}/skill-md`]);
  // Access taken away: the next open asks the server again and shows nothing it no longer allows.
  await assert.rejects(loadSharedSkillMd(async <T>(path: string) => { paths.push(path); throw new Error("404") as T; },
    releaseId, new AbortController().signal));
  assert.equal(paths.length, 2, "Never answered from an earlier read");
});
