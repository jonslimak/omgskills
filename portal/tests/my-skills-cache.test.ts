import assert from "node:assert/strict";
import test from "node:test";
import { clearMySkillsCache, readMySkillsCache, writeMySkillsCache, type MySkillsCache } from "../src/integration/unified/my-skills-cache";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

const cache = {
  data: {
    skills: [{ id: "s1", name: "seo-audit", source: "Claude", description: null, githubUrl: null }],
    sets: [{ id: "g1", name: "Marketing", ownerName: "Jon", role: "owner", items: [], emails: [] }],
    devices: [{ id: "d1", deviceName: "Mac", status: "active", lastReportedAt: null }],
    profile: { handle: "jon", name: "Jon", email: "j@example.com", published: false, publicUrl: null },
    privateSourceConnected: null,
  },
  cloud: { settings: { enabled: true, excludedSkillKeys: [] }, usage: { bytes: 1, limitBytes: 2 }, skills: [], needsReview: [], skipped: {} },
  additions: [{ catalogId: "c1" }],
} as unknown as MySkillsCache;

test("a saved My skills comes back for the same account only", () => {
  const store = memoryStore();
  writeMySkillsCache("user_a", cache, 1000, store);
  assert.deepEqual(readMySkillsCache("user_a", 2000, store), cache);
  assert.equal(readMySkillsCache("user_b", 2000, store), null);
});

test("an old, future-dated or broken entry is dropped", () => {
  const store = memoryStore();
  writeMySkillsCache("user_a", cache, 0, store);
  assert.equal(readMySkillsCache("user_a", 8 * 24 * 60 * 60 * 1000, store), null);
  assert.equal(store.map.size, 0);
  writeMySkillsCache("user_a", cache, 5000, store);
  assert.equal(readMySkillsCache("user_a", 1000, store), null);
  store.setItem("omgskills.myskills.v1.user_a", JSON.stringify({ at: 1, data: { skills: "nope" }, cloud: null, additions: null }));
  assert.equal(readMySkillsCache("user_a", 2, store), null);
  store.setItem("omgskills.myskills.v1.user_a", "{not json");
  assert.equal(readMySkillsCache("user_a", 2, store), null);
});

test("sign-out clears every account's entry and nothing else", () => {
  const store = memoryStore();
  writeMySkillsCache("user_a", cache, 1, store);
  writeMySkillsCache("user_b", cache, 1, store);
  store.setItem("other", "keep");
  clearMySkillsCache(store);
  assert.deepEqual([...store.map.keys()], ["other"]);
});

test("no storage means no cache, without throwing", () => {
  assert.equal(readMySkillsCache("user_a", 1, null), null);
  writeMySkillsCache("user_a", cache, 1, null);
  clearMySkillsCache(null);
});
