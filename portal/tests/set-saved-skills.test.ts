import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PortalApi } from "../src/portal-api";
import { groupSyncedSkills, type SyncedSkill } from "../src/synced-skill-grouping";
import { addManyMembership, addSavedMembership, changeMembership } from "../src/integration/membership-data";
import { addable, setStatus } from "../src/integration/unified/set-adds";
import type { PortalSet } from "../src/app/model";
import type { SkillDisplay } from "../src/app/unified/model";

const signal = () => new AbortController().signal;
const installed = groupSyncedSkills([{ id: "local", name: "Local", description: "", catalogSkillId: null, githubUrl: null,
  isLocalOnly: true, source: "Claude", lastSeenAt: "2026-11-15T00:00:00Z" } as SyncedSkill])[0];

// A Set the fake server keeps: POSTs add synced (installed or saved copy) and catalog items.
function server(initial: Record<string, unknown>[] = []) {
  const items: Record<string, unknown>[] = [...initial];
  const posts: unknown[] = [];
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      const id = path.split("/")[4] ?? "set";
      return { group: { id, name: "Set", visibility: "private" }, accessRole: "owner",
        items: items.map((item, position) => ({ name: "x", description: "", githubUrl: null, position, ...item })) } as T;
    }
    if (path === "/api/portal/groups") { posts.push({ create: JSON.parse(init!.body as string) }); return { groupId: "new" } as T; }
    const body = JSON.parse(init!.body as string);
    posts.push(body);
    const id = `item-${items.length}`;
    items.push(body.kind === "catalog" ? { id, kind: "catalog", syncedSkillId: null, catalogSkillId: body.catalogSkillId }
      : body.cloudKey ? { id, kind: "synced", syncedSkillId: null, cloudKey: body.cloudKey }
      : { id, kind: "synced", syncedSkillId: body.syncedSkillId });
    return { itemId: id } as T;
  };
  return { api, posts, items };
}

test("one add takes installed, saved library and saved personal skills together", async () => {
  const s = server();
  const result = await addManyMembership(s.api, [], { kind: "add-many", id: "set", skills: [installed],
    catalogIds: ["owner/repo:pdf"], saved: [{ key: "notes", name: "notes" }] }, [installed], signal());
  assert.equal(result.added, 3);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(s.posts, [{ kind: "synced", syncedSkillId: "local" }, { kind: "catalog", catalogSkillId: "owner/repo:pdf" },
    { kind: "synced", cloudKey: "notes" }]);
});

test("a saved skill already in the Set isn't added twice, and doesn't block adding installed skills", async () => {
  const s = server([{ id: "saved", kind: "synced", syncedSkillId: null, cloudKey: "notes" }]);
  const again = await addSavedMembership(s.api, "set", [{ key: "notes", name: "notes" }], signal());
  assert.equal(again.unchanged, 1);
  assert.equal(s.posts.length, 0);
  const more = await changeMembership(s.api, "set", [installed], true, signal());
  assert.equal(more.added, 1, "an item added by its saved copy isn't 'incomplete membership'");
});

test("New set with saved skills creates the Set, then adds them", async () => {
  const s = server();
  const result = await addManyMembership(s.api, [], { kind: "add-many", name: "Mine", skills: [], catalogIds: [],
    saved: [{ key: "notes", name: "notes" }] }, [], signal());
  assert.equal(result.groupId, "new");
  assert.deepEqual(s.posts, [{ create: { name: "Mine", visibility: "private", syncedSkillIds: [] } }, { kind: "synced", cloudKey: "notes" }]);
});

test("rows split by what they are, and the Set picker knows which are already in", () => {
  const row = (fields: Partial<SkillDisplay>) => ({ key: fields.name, name: "x", ...fields }) as SkillDisplay;
  const split = addable([row({ name: "a", installed }), row({ name: "b", catalogId: "o/r:b", added: true }), row({ name: "c", cloudKey: "c" })]);
  assert.deepEqual(split, { skills: [installed], catalogIds: ["o/r:b"], saved: [{ key: "c", name: "c" }] });
  assert.throws(() => addable([row({ name: "d" })]));
  const set = { items: [{ id: "1", kind: "synced", syncedSkillId: null, cloudKey: "c", name: "c", description: "", githubUrl: null },
    { id: "2", kind: "catalog", syncedSkillId: null, catalogSkillId: "o/r:b", name: "b", description: "", githubUrl: null }] } as unknown as PortalSet;
  assert.equal(setStatus(set, row({ cloudKey: "c" })), true);
  assert.equal(setStatus(set, row({ cloudKey: "z" })), false);
  assert.equal(setStatus(set, row({ catalogId: "o/r:b" })), true);
});

test("saved skills get Add to set in the panel, row menu and edit bar; Favorites stays installed or library only", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Sets hold installed skills/);
  assert.match(source, /settable\(skill\) && <MenuItem icon=\{ListPlus\}/);
  assert.match(source, /onClick=\{\(\) => addToSet\(forSets\)\}/);
  assert.match(source, /\(detail\.installed \|\| detail\.catalogId \|\| settable\(detail\)\)/);
});
