import assert from "node:assert/strict";
import test from "node:test";
import { PortalApiError } from "../src/api-error";
import { cloudSkillKey, cloudSkillRows, deleteCloudSaved, formatBytes, loadCloudSave, type CloudSaveState } from "../src/cloud-save/cloud-save";
import type { SyncedSkill } from "../src/synced-skill-grouping";

const installed = (name: string, extra: Partial<SyncedSkill> = {}): SyncedSkill => ({
  id: name, name, description: null, githubUrl: null, isLocalOnly: true, source: "claude", lastSeenAt: "2026-11-01", ...extra,
});

const state = (overrides: Partial<CloudSaveState> = {}): CloudSaveState => ({
  settings: { enabled: true, excludedSkillKeys: [] },
  usage: { bytes: 0, limitBytes: 1024 ** 3 },
  skills: [],
  needsReview: [],
  ...overrides,
});

const saved = (key: string, deletedLocallyAt: string | null = null) => ({
  key, versionCount: 2, deletedLocallyAt,
  currentVersion: { id: `r-${key}`, savedAt: "2026-11-02T10:00:00Z", fileCount: 1, totalBytes: 10, labels: ["scripts" as const] },
});

test("skill keys match the server's folder-name identity", () => {
  assert.equal(cloudSkillKey("My-Notes"), "my-notes");
  assert.equal(cloudSkillKey(" padded"), " padded");
  assert.equal(cloudSkillKey("Café"), "café");
});

test("every skill gets one row with an honest status, reviews first", () => {
  const rows = cloudSkillRows(state({
    settings: { enabled: true, excludedSkillKeys: ["private"] },
    skills: [saved("notes"), saved("gone", "2026-11-02T11:00:00Z")],
    needsReview: [{ key: "deploy", confirmed: false, updatedAt: "", files: [{ path: "config.env", findings: [{ rule: "github_token", kind: "GitHub token", line: 1 }] }] }],
  }), [
    installed("Notes", { installationFolder: "notes" }),
    installed("Notes", { installationFolder: "notes", source: "codex" }),
    installed("deploy"),
    installed("private"),
    installed("pdf", { catalogSkillId: "anthropics/skills:pdf", isLocalOnly: false }),
    installed("new-one"),
    installed("old", { isCurrent: false }),
  ]);
  assert.deepEqual(rows.map(row => [row.key, row.status]), [
    ["deploy", "review"], ["notes", "saved"], ["gone", "deleted"], ["new-one", "waiting"], ["pdf", "library"], ["private", "excluded"],
  ]);
  assert.deepEqual(rows.find(row => row.key === "notes")?.labels, ["scripts"]);
  assert.equal(rows[0].findings[0].findings[0].line, 1);
});

test("with cloud save off, unsaved skills read as not saved", () => {
  const rows = cloudSkillRows(state({ settings: { enabled: false, excludedSkillKeys: [] } }), [installed("notes")]);
  assert.deepEqual(rows.map(row => row.status), ["off"]);
});

test("a 503 means cloud save isn't switched on yet; other errors surface", async () => {
  assert.deepEqual(await loadCloudSave(async () => { throw new PortalApiError("off", 503); }), { status: "unavailable" });
  await assert.rejects(loadCloudSave(async () => { throw new PortalApiError("nope", 500); }), /nope/);
  const ready = await loadCloudSave(async <T>() => ({ ...state(), needsReview: undefined }) as T);
  assert.deepEqual(ready.status === "ready" && ready.state.needsReview, []);
});

test("sizes read naturally", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(3.2 * 1024 * 1024), "3.2 MB");
  assert.equal(formatBytes(1024 ** 3), "1.0 GB");
});

test("delete calls the one-skill or everything route", async () => {
  const calls: string[] = [];
  const api = async <T>(path: string, init?: RequestInit) => { calls.push(`${init?.method} ${path}`); return {} as T; };
  await deleteCloudSaved(api, "my notes");
  await deleteCloudSaved(api);
  assert.deepEqual(calls, ["DELETE /api/portal/cloud-save/skills/my%20notes", "DELETE /api/portal/cloud-save"]);
});
