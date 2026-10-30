import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { PublishedCatalogIdentity } from "./published-catalog.js";
import { readSyncInventory } from "./sync-inventory-read.js";

const sha = "c".repeat(40);
const row = (overrides: Record<string, unknown>) => ({
  id: "row", stableKey: "location:v1:codex:remotion-render", skillMdSha: sha, identityStatus: "ambiguous",
  name: "remotion-render", description: "Export a Remotion video", catalogSkillId: null, githubUrl: null,
  isLocalOnly: false, source: "codex", isCurrent: true, lastSeenAt: null, deviceId: "mac",
  gitRelativePath: null, catalogSkillIdHint: "remotion-dev/skills:remotion-render", ...overrides,
});

function pool(rows: unknown[]): Pool {
  return { query: async (sql: string) => ({ rows: sql.includes("FROM synced_skills") ? rows : [] }) } as unknown as Pool;
}

const catalog: PublishedCatalogIdentity = {
  track: "fixture",
  liveSkillIds: new Set(["remotion-dev/skills:remotion-render"]),
  shaHistory: { version: 1, shaToSkillIds: { [sha]: ["remotion-dev/skills:remotion-render"] } },
};

test("inventory reads link hinted rows whose fingerprint is a published version", async () => {
  const edited = row({ id: "edited", skillMdSha: "d".repeat(40) });
  const { skills } = await readSyncInventory(pool([row({}), edited]), "user", 2, new Date(), async () => catalog) as {
    skills: Array<{ id: string; catalogSkillId: string | null; identityStatus: string }>
  };
  assert.deepEqual(skills.map(({ id, catalogSkillId, identityStatus }) => ({ id, catalogSkillId, identityStatus })), [
    { id: "row", catalogSkillId: "remotion-dev/skills:remotion-render", identityStatus: "resolved" },
    { id: "edited", catalogSkillId: null, identityStatus: "ambiguous" },
  ]);
});

test("inventory reads skip the catalog when nothing is hinted, and survive it being unavailable", async () => {
  let loads = 0;
  await readSyncInventory(pool([row({ catalogSkillIdHint: null })]), "user", 2, new Date(), async () => { loads++; return catalog; });
  assert.equal(loads, 0);
  const { skills } = await readSyncInventory(pool([row({})]), "user", 2, new Date(), async () => { throw new Error("offline"); }) as {
    skills: Array<{ catalogSkillId: string | null }>
  };
  assert.equal(skills[0].catalogSkillId, null);
});
