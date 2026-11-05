import assert from "node:assert/strict";
import test from "node:test";
import { PortalApiError } from "../src/api-error";
import { cloudSkillKey, cloudSkillRows, deleteCloudSaved, loadSavedSkillMd, formatBytes, isDeletingAllCloudSkills, isDeletingCloudSkill, loadCloudSave, type CloudSaveState } from "../src/cloud-save/cloud-save";
import type { SyncedSkill } from "../src/synced-skill-grouping";
import { savedSkillKeys } from "../src/app/unified/SkillReadme";

const installed = (name: string, extra: Partial<SyncedSkill> = {}): SyncedSkill => ({
  id: name, name, description: null, githubUrl: null, isLocalOnly: true, source: "claude", lastSeenAt: "2026-11-01", ...extra,
});

const state = (overrides: Partial<CloudSaveState> = {}): CloudSaveState => ({
  settings: { enabled: true, excludedSkillKeys: [] },
  usage: { bytes: 0, limitBytes: 1024 ** 3 },
  skills: [],
  needsReview: [],
  skipped: {},
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
    ["deploy", "review"], ["notes", "saved"], ["gone", "deleted"], ["new-one", "waiting"], ["pdf", "waiting"], ["private", "excluded"],
  ]);
  assert.deepEqual(rows.find(row => row.key === "notes")?.labels, ["scripts"]);
  assert.equal(rows[0].findings[0].findings[0].line, 1);
});

test("with cloud save off, unsaved skills read as not saved", () => {
  const rows = cloudSkillRows(state({ settings: { enabled: false, excludedSkillKeys: [] } }), [installed("notes")]);
  assert.deepEqual(rows.map(row => row.status), ["off"]);
});

test("a Mac's reason for not saving a skill wins over guessing", () => {
  const rows = cloudSkillRows(state({
    skills: [saved("notes")],
    skipped: { ship: "links", pdf: "failed", huge: "too_large", odd: "unreadable", spec: "library", notes: "failed" },
  }), [
    installed("ship", { catalogSkillId: "garrytan/gstack:ship", isLocalOnly: false }),
    installed("pdf", { catalogSkillId: "anthropics/skills:pdf", isLocalOnly: false }),
    installed("huge"), installed("odd"), installed("spec"), installed("notes"), installed("fresh"),
  ]);
  assert.deepEqual(rows.map(row => [row.key, row.status]), [
    ["notes", "saved"], ["pdf", "failed"], ["ship", "links"], ["huge", "too_large"], ["odd", "unreadable"],
    ["fresh", "waiting"], ["spec", "waiting"],
  ]);
  // With cloud save off, nothing is being saved, so old reasons don't show.
  const off = cloudSkillRows(state({ settings: { enabled: false, excludedSkillKeys: [] }, skipped: { ship: "links" } }),
    [installed("ship")]);
  assert.deepEqual(off.map(row => row.status), ["off"]);
});

test("two folders with the same skill name show which folder is which", () => {
  const rows = cloudSkillRows(state(), [
    installed("open-gstack-browser", { installationFolder: "open-gstack-browser" }),
    installed("open-gstack-browser", { installationFolder: "connect-chrome" }),
    installed("Notes", { installationFolder: "notes" }),
  ]);
  assert.deepEqual(rows.map(row => row.name), ["Notes", "open-gstack-browser", "open-gstack-browser (folder connect-chrome)"]);
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

test("deleting a skill named * never selects delete all, and vice versa", () => {
  const one = { kind: "skill", key: "*" } as const;
  const all = { kind: "all" } as const;
  assert.equal(isDeletingCloudSkill(one, "*"), true);
  assert.equal(isDeletingCloudSkill(one, "other"), false);
  assert.equal(isDeletingAllCloudSkills(one), false);
  assert.equal(isDeletingCloudSkill(all, "*"), false);
  assert.equal(isDeletingAllCloudSkills(all), true);
  assert.equal(isDeletingCloudSkill(null, "*"), false);
  assert.equal(isDeletingAllCloudSkills(null), false);
});

test("a local skill's instructions come from the first folder with a saved copy", async () => {
  const calls: string[] = [];
  const api = async <T>(path: string) => {
    calls.push(path);
    if (path.includes("/connect-chrome/")) throw new PortalApiError("Saved skill not found", 404);
    return { key: "open-gstack-browser", markdown: "# Hi", truncated: false, savedAt: "2026-11-03T10:00:00Z" } as T;
  };
  const doc = await loadSavedSkillMd(api, ["connect-chrome", "open-gstack-browser"], new AbortController().signal);
  assert.equal(doc?.markdown, "# Hi");
  assert.deepEqual(calls, ["/api/portal/cloud-save/skills/connect-chrome/skill-md", "/api/portal/cloud-save/skills/open-gstack-browser/skill-md"]);

  const none = await loadSavedSkillMd(async () => { throw new PortalApiError("Saved skill not found", 404); }, ["a"], new AbortController().signal);
  assert.equal(none, null);
  await assert.rejects(loadSavedSkillMd(async () => { throw new PortalApiError("Denied", 401); }, ["a"], new AbortController().signal));
});

test("a skill's cloud keys are its folders on every Mac, once each", () => {
  const source = (name: string, installationFolder?: string) => installed(name, { installationFolder });
  const keys = savedSkillKeys({ key: "x", name: "Notes", githubUrl: null,
    installed: { ...source("Notes", "notes"), allSkillIds: [], sources: [], sourceSkills: [source("Notes", "Notes"), source("Notes", "notes"), source("Other")] },
  } as never);
  assert.deepEqual(keys, ["notes", "other"]);
});

test("my skills marks only skills cloud save can't keep, and picks the copy that needs attention", async () => {
  const { needsAttention, skillCloudRow } = await import("../src/cloud-save/cloud-save");
  assert.deepEqual(["saved", "deleted", "confirmed", "library", "excluded", "waiting", "off"].filter(status => needsAttention(status as never)), []);
  assert.deepEqual(["review", "links", "too_large", "unreadable", "failed"].every(status => needsAttention(status as never)), true);
  const row = (key: string, status: string) => ({ key, name: key, status, versionCount: 0, setCount: 0, savedAt: null, labels: [], findings: [] }) as never;
  const rows = new Map([["a", row("a", "saved")], ["b", row("b", "links")], ["c", row("c", "library")]]);
  assert.equal(skillCloudRow(rows, ["a", "b"])?.key, "b", "A copy that can't be saved wins over a saved one");
  assert.equal(skillCloudRow(rows, ["c", "a"])?.key, "a");
  assert.equal(skillCloudRow(rows, ["missing"]), null);
});

test("Show splits my skills into personal (own) and public (library), each by name, and survives the address", async () => {
  const { skillsByOrigin, parseNavigation, navigationSearch, initialNavigation } = await import("../src/app/unified/model");
  const skill = (name: string, catalogId?: string) => ({ key: name, name, catalogId }) as never;
  const split = skillsByOrigin([skill("zeta", "a/b:zeta"), skill("beta"), skill("Alpha"), skill("delta", "a/b:delta")]);
  assert.deepEqual(split.personal.map((s: { name: string }) => s.name), ["Alpha", "beta"]);
  assert.deepEqual(split.public.map((s: { name: string }) => s.name), ["delta", "zeta"]);
  assert.equal(parseNavigation(navigationSearch({ ...initialNavigation, show: "origin" })).show, "origin");
  assert.equal(parseNavigation("?view=all&show=bogus").show, undefined);
  assert.equal(parseNavigation("?view=discover&show=public").show, undefined, "Only my own lists");
});

test("the letter index files names by first letter and lands on the next letter that has skills", async () => {
  const { railLetter, railTarget } = await import("../src/app/unified/AlphaRail");
  assert.deepEqual(["api", "Élan", "  zod", "3d", "_x"].map(railLetter), ["A", "E", "Z", "#", "#"]);
  assert.equal(railTarget(["#", "A", "D", "S"], "B"), "D");
  assert.equal(railTarget(["#", "A", "D", "S"], "S"), "S");
  assert.equal(railTarget(["#", "A", "D", "S"], "Z"), "S", "Past the last letter stays at the end");
  assert.equal(railTarget([], "A"), null);
});

test("a private skill installed from a Set says it came from the Set, not the library", async () => {
  const copy = (key: string) => ({ key, versionCount: 1, deletedLocallyAt: null, setCount: 0,
    currentVersion: { id: `r-${key}`, savedAt: "2026-11-05T00:00:00Z", fileCount: 1, totalBytes: 1 } });
  const rows = cloudSkillRows(state({ skills: [copy("team"), copy("pdf")], needsReview: [], skipped: {} }), [
    installed("team", { installedFromSet: "Team" }),
    installed("pdf", { catalogSkillId: "anthropics/skills:pdf", installedFromSet: "Team", isLocalOnly: false }),
  ]);
  assert.deepEqual(rows.map(row => [row.key, row.status]).sort(), [["pdf", "library"], ["team", "set"]]);
  const { statusText, needsAttention } = await import("../src/cloud-save/cloud-save");
  assert.equal(statusText.set, "Saved · from a Set");
  assert.equal(needsAttention("set"), false);
  // Not uploaded yet (or an older Mac skipped it): honest about it, never "Saved".
  const unsaved = cloudSkillRows(state({ skills: [], needsReview: [], skipped: { pdf: "library" } }),
    [installed("pdf", { catalogSkillId: "anthropics/skills:pdf", isLocalOnly: false })]);
  assert.deepEqual([unsaved[0].status, unsaved[0].origin], ["waiting", "library"]);
});

test("Needs attention survives account navigation; other ids on My skills don't", async () => {
  const { accountNavigation } = await import("../src/integration/unified/policy");
  const { initialNavigation } = await import("../src/app/unified/model");
  assert.equal(accountNavigation({ ...initialNavigation, id: "attention", show: "public" }, true).id, "attention");
  assert.equal(accountNavigation({ ...initialNavigation, id: "other" }, true).id, "");
  assert.equal(accountNavigation({ ...initialNavigation, view: "favorites", id: "attention" }, true).id, "");
});

test("the letter rail uses the letters the list has, in rail order", async () => {
  const { railLettersOf } = await import("../src/app/unified/AlphaRail");
  assert.deepEqual(railLettersOf([{ name: "zod" }, { name: "3d" }, { name: "api" }, { name: "Alpha" }]), ["#", "A", "Z"]);
});

test("one summary line: every skill counts, then only what needs a look", async () => {
  const { cloudSummaryText } = await import("../src/cloud-save/cloud-save");
  const row = (status: string, onMac = true) => ({ key: status, name: status, status, versionCount: 0, setCount: 0, savedAt: null,
    labels: [], findings: [], onMac }) as never;
  assert.equal(cloudSummaryText([row("saved"), row("library"), row("set"), row("deleted", false)]), "4 skills · all saved · 1 not on your Macs");
  assert.equal(cloudSummaryText([row("saved"), row("review"), row("links")]), "3 skills · 2 need attention");
  assert.equal(cloudSummaryText([row("saved"), row("too_large"), row("waiting"), row("excluded")]),
    "4 skills · 1 needs attention · 1 not saved yet · 1 left out");
  assert.equal(cloudSummaryText([row("saved")]), "1 skill · all saved");
  const rows = cloudSkillRows(state({ skills: [{ key: "gone", versionCount: 1, deletedLocallyAt: "2026-11-01T00:00:00Z", setCount: 0,
    currentVersion: { id: "r", savedAt: "2026-11-01T00:00:00Z", fileCount: 1, totalBytes: 1 } }], needsReview: [], skipped: {} }), [installed("here")]);
  assert.deepEqual(rows.map(r => [r.key, r.onMac]).sort(), [["gone", false], ["here", true]]);
});

test("a library install saved to the cloud keeps its library label and its versions", () => {
  const rows = cloudSkillRows(state({ needsReview: [], skipped: {}, skills: [{ key: "pdf", versionCount: 2, deletedLocallyAt: null, setCount: 0,
    currentVersion: { id: "r2", savedAt: "2026-11-05T00:00:00Z", fileCount: 3, totalBytes: 10 } }] }),
    [installed("pdf", { catalogSkillId: "anthropics/skills:pdf", isLocalOnly: false })]);
  assert.deepEqual([rows[0].status, rows[0].versionCount], ["library", 2]);
});
