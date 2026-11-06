import assert from "node:assert/strict";
import test from "node:test";
import { buildMySkills, loadMySkills } from "../../netlify/functions/_shared/my-skills-library";
import type { CloudSaveState as ServerCloudState } from "../../netlify/functions/_shared/cloud-save";
import { addedSkills, liveMine, notInstalledSkills, skillDisplays, type SkillDisplay } from "../src/app/unified/model";
import { cloudSkillRows, skillCloudRow, type CloudSaveState } from "../src/cloud-save/cloud-save";
import { savedSkillKeys } from "../src/app/unified/SkillReadme";
import type { SyncedSkill } from "../src/synced-skill-grouping";

const now = Date.parse("2026-11-06T12:00:00Z");
const recent = "2026-11-05T00:00:00.000Z";
const stale = "2026-08-01T00:00:00.000Z";

function copy(id: string, name: string, extra: Partial<SyncedSkill> = {}): SyncedSkill {
  return { id, name, description: `${name} does things`, source: "claude", skillMdSha: "a".repeat(40),
    identityStatus: "localOnly", catalogSkillId: null, githubUrl: null, isLocalOnly: true, lastSeenAt: recent,
    deviceId: "mac-a", installationFolder: name, isCurrent: true, ...extra };
}

const inventory: SyncedSkill[] = [
  copy("1", "notes"),
  copy("2", "notes", { deviceId: "mac-b", source: "codex" }),
  copy("3", "pdf", { catalogSkillId: "anthropics/skills:pdf", identityStatus: "resolved", isLocalOnly: false,
    githubUrl: "https://github.com/anthropics/skills" }),
  copy("4", "team-style", { installedFromSet: "Team" }),
  copy("5", "old-legacy", { deviceId: null, lastSeenAt: stale }),
  copy("6", "gone-now", { isCurrent: false }),
  copy("7", "secrets"),
  copy("8", "left-out"),
  copy("9", "big"),
  copy("10", "Twin", { installationFolder: "twin-a" }),
  copy("11", "Twin", { installationFolder: "twin-b", source: "codex" }),
  copy("12", "confirmed"),
];

const version = (savedAt: string, labels: string[] = []) =>
  ({ id: "v", sourceId: "s", commitSha: "c", treeSha: "t", skillMdSha: "m", fileCount: 1, totalBytes: 10, deviceId: "mac-a", savedAt, labels });
const saved = (key: string, extra: { deletedLocallyAt?: string | null; labels?: string[] } = {}) =>
  ({ key, versionCount: 1, setCount: 0, deletedLocallyAt: extra.deletedLocallyAt ?? null, currentVersion: version(recent, extra.labels) });

const cloud = {
  settings: { enabled: true, excludedSkillKeys: ["left-out"] },
  usage: { bytes: 0, limitBytes: 1 },
  skills: [saved("notes"), saved("pdf"), saved("gone-now", { deletedLocallyAt: recent }), saved("old-legacy"),
    saved("only-saved"), saved("twin-a"), saved("confirmed", { labels: ["confirmed_secret"] })],
  needsReview: [{ key: "secrets", deviceId: "mac-a", files: [], confirmed: false, updatedAt: recent }],
  skipped: { big: "too_large" },
};
const additions = ["anthropics/skills:pdf", "anthropics/skills:xlsx", "anthropics/skills:xlsx", "someone/repo:docx"];
const library = new Map([["anthropics/skills:xlsx", { name: "XLSX", description: "Spreadsheets", author: "anthropics" }]]);

/** The web's My skills, built exactly as UnifiedApp does it. */
function webMySkills() {
  const catalog = { skills: [{ id: "anthropics/skills:xlsx", name: "XLSX", description: "Spreadsheets", author: "anthropics",
    tags: [], githubUrl: null }], collections: [], creators: [], categories: [], trendingIds: [] };
  const displays = skillDisplays({ skills: inventory } as never, catalog as never);
  const everMine = displays.mine;
  const mine = liveMine(everMine, now);
  const rows = new Map(cloudSkillRows(cloud as unknown as CloudSaveState, inventory).map(row => [row.key, row]));
  const notInstalled = notInstalledSkills([...rows.values()], mine, everMine, savedSkillKeys);
  const added = addedSkills(additions.map(catalogId => ({ catalogId })), displays.library, mine);
  const notInstalledAll = [...notInstalled, ...added.filter(skill => !notInstalled.some(other => other.catalogId === skill.catalogId))];
  const all = [...mine, ...notInstalledAll];
  const status = (skill: SkillDisplay) => (skill.installed || skill.cloudKey)
    ? skillCloudRow(rows, savedSkillKeys(skill))?.status ?? null : null;
  return { all, notInstalledAll, status };
}

test("the server builds the same My skills list and count as the web", () => {
  const web = webMySkills();
  const server = buildMySkills({ inventory, cloud: cloud as unknown as ServerCloudState, additions, catalog: library, now });
  assert.equal(server.count, web.all.length);
  assert.equal(server.notInstalledCount, web.notInstalledAll.length);
  type Row = { name: string; description: string; author: string; catalogId?: string | null };
  const shape = (skill: Row, installed: boolean, status: string | null) =>
    `${skill.name}|${skill.description}|${skill.author}|${installed}|${skill.catalogId ?? ""}|${status ?? ""}`;
  assert.deepEqual(
    server.skills.map(skill => shape(skill, skill.installed, skill.status)).sort(),
    web.all.map(skill => shape(skill, !!skill.installed, web.status(skill))).sort());
  assert.equal(new Set(server.skills.map(skill => skill.id)).size, server.skills.length, "IDs are unique");
});

test("what an agent may read of each skill", () => {
  const { skills } = buildMySkills({ inventory, cloud: cloud as unknown as ServerCloudState, additions, catalog: library, now });
  const by = (name: string) => skills.find(skill => skill.name === name)!;
  assert.deepEqual([by("notes").available, by("notes").source, by("notes").savedKey], [true, "saved", "notes"]);
  assert.deepEqual([by("pdf").source, by("pdf").id], ["saved", "lib:anthropics/skills:pdf"], "Your saved copy beats the public one");
  assert.deepEqual([by("XLSX").source, by("XLSX").installed, by("XLSX").author], ["public", false, "anthropics"]);
  assert.deepEqual([by("docx").source, by("docx").author], ["public", "someone"], "Unknown to the library: named from its ID");
  assert.equal(by("team-style").origin, "set");
  assert.deepEqual([by("team-style").available, by("team-style").reason], [false, "It's only on your Mac (not synced)."]);
  for (const locked of ["secrets", "big", "confirmed"]) {
    assert.equal(by(locked).available, false, locked);
    assert.equal(by(locked).source, null, locked);
  }
  assert.match(by("left-out").reason!, /left out/);
  assert.deepEqual([by("only-saved").installed, by("only-saved").source], [false, "saved"]);
  assert.equal(skills.filter(skill => skill.name === "XLSX").length, 1, "A repeated addition counts once");
});

test("cloud save down still lists everything a Mac reported, and says it's partial", async () => {
  const result = await loadMySkills("user-1", {
    readInventory: async () => inventory,
    readCloud: async () => { throw new Error("down"); },
    readAdditions: async () => ["anthropics/skills:xlsx"],
    catalogDetails: async () => { throw new Error("slow"); },
    now: () => now,
  });
  assert.deepEqual(result.partial.sort(), ["catalog", "cloud"]);
  assert.ok(result.skills.some(skill => skill.name === "notes" && skill.installed));
  assert.equal(result.skills.find(skill => skill.name === "notes")!.available, false, "Without cloud save nothing is known to be saved");
  assert.equal(result.skills.find(skill => skill.name === "xlsx")!.source, "public");
});

test("one locked folder locks the skill, and a left-out folder's copy is never read", () => {
  const twin = [copy("a", "Twin", { installationFolder: "twin-a" }), copy("b", "Twin", { installationFolder: "twin-b", source: "codex" })];
  const state = (skills: unknown[], excluded: string[] = []) => ({ ...cloud, skills, needsReview: [], skipped: {},
    settings: { enabled: true, excludedSkillKeys: excluded } }) as unknown as ServerCloudState;
  const secret = buildMySkills({ inventory: twin, additions: [], now,
    cloud: state([saved("twin-a", { deletedLocallyAt: recent, labels: ["confirmed_secret"] }), saved("twin-b")]) }).skills[0];
  assert.deepEqual([secret.available, secret.source], [false, null]);
  const leftOut = buildMySkills({ inventory: twin, additions: [], now, cloud: state([saved("twin-a")], ["twin-a"]) }).skills[0];
  assert.notEqual(leftOut.savedKey, "twin-a");
  assert.equal(leftOut.available, false);
});

test("IDs stay put as copies come and go, and shared library IDs are told apart by name", () => {
  const both = [copy("a", "Notes", { installationFolder: "notes-b" }), copy("b", "Notes", { installationFolder: "notes-a", source: "codex" })];
  const first = buildMySkills({ inventory: both, cloud: null, additions: [], now }).skills[0].id;
  const later = buildMySkills({ inventory: [both[0], { ...both[1], isCurrent: false }], cloud: null, additions: [], now }).skills[0].id;
  assert.equal(first, "key:notes-a");
  assert.equal(later, first);
  const lib = { catalogSkillId: "o/r:pdf", identityStatus: "resolved" as const, isLocalOnly: false };
  const ids = buildMySkills({ inventory: [copy("x", "pdf", lib), copy("y", "PDF tools", lib)], cloud: null, additions: [], now })
    .skills.map(skill => skill.id).sort();
  assert.deepEqual(ids, ["lib:o/r:pdf#pdf", "lib:o/r:pdf#pdf tools"]);
  const dated = buildMySkills({ inventory: [copy("d", "old", { deviceId: null, lastSeenAt: new Date(stale) as never })], cloud: null,
    additions: [], now });
  assert.equal(dated.count, 0, "A database Date is read like a string");
});
