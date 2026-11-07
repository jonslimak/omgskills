import assert from "node:assert/strict";
import test from "node:test";
import { candidateKey, cloudSkillKeys } from "./cloud-skill-keys.js";

const copy = (source: string, name: string, folder = "last30days", deviceId: string | null = "mac-1", isCurrent = true) =>
  ({ source, name, installationFolder: folder, deviceId, isCurrent });

test("different skills in same-name folders get their own cloud keys; copies of one skill share it", () => {
  const library = copy("claude", "last30days"), spec = copy("codex", "last30days-v3-spec");
  const keys = cloudSkillKeys([spec, library]);
  assert.equal(keys.get(library), "last30days", "The skill named like its folder keeps the folder key");
  assert.equal(keys.get(spec), "last30days@codex");

  const a = copy("claude", "PDF", "pdf"), b = copy("codex", "pdf", "pdf"), c = copy("agents", "PDF", "PDF");
  assert.deepEqual([...cloudSkillKeys([a, b, c]).values()], ["pdf", "pdf", "pdf"], "Same name, any case, is one skill");
});

test("when no copy is named like its folder, the first agent's keeps the folder key", () => {
  const x = copy("codex", "Writer"), y = copy("agents", "Editor"), z = copy("claude", "Editor");
  const keys = cloudSkillKeys([x, y, z]);
  assert.equal(keys.get(y), "last30days", "Editor is on claude, the first agent");
  assert.equal(keys.get(z), "last30days");
  assert.equal(keys.get(x), "last30days@codex");
});

test("a skill on another Mac never takes a key that holds a different skill", () => {
  const here = copy("claude", "last30days"), other = copy("codex", "last30days-v3-spec", "last30days", "mac-2");
  const old = copy("codex", "last30days", "last30days", "mac-1", false);
  const keys = cloudSkillKeys([here, other, old]);
  assert.deepEqual([keys.get(here), keys.get(other), keys.get(old)], ["last30days", "last30days@codex", "last30days"]);
});

test("a saved skill keeps its key: matched by SKILL.md name, whatever else is installed", () => {
  const records = [{ key: "last30days", name: "last30days" }, { key: "last30days@codex", name: "last30days-v3-spec" }];
  // The library copy was deleted; the spec stays on its own key instead of taking the library's.
  const spec = copy("codex", "last30days-v3-spec");
  assert.equal(cloudSkillKeys([spec], records).get(spec), "last30days@codex");
  // A Mac with only the spec, in another agent, finds the same record.
  const elsewhere = copy("agents", "Last30days-v3-spec", "last30days", "mac-2");
  assert.equal(cloudSkillKeys([elsewhere], records).get(elsewhere), "last30days@codex");
  // A new, different skill in the same folder gets a key no other skill holds.
  const third = copy("codex", "something-else", "last30days", "mac-3");
  assert.equal(cloudSkillKeys([third], records).get(third), "last30days@codex-2");
});

test("skills saved before names were kept can be taken by the first skill to claim them", () => {
  const records = [{ key: "last30days", name: null }];
  const library = copy("claude", "last30days"), spec = copy("codex", "last30days-v3-spec");
  const keys = cloudSkillKeys([spec, library], records);
  assert.deepEqual([keys.get(library), keys.get(spec)], ["last30days", "last30days@codex"]);
});

test("derived keys stay within the key length limit", () => {
  const folder = "a".repeat(200);
  const keys = cloudSkillKeys([copy("claude", folder, folder), copy("codex", "other", folder)]);
  assert.deepEqual([...keys.values()].map(key => key.length), [200, 200]);
  assert.ok([...keys.values()][1].endsWith("@codex"));
});

test("long keys keep whole characters, counted as the server counts them", () => {
  assert.equal(candidateKey("é".repeat(191) + "😀😀", "codex", 1), `${"é".repeat(191)}😀@codex`);
});

test("a saved skill keeps a key whose folder part was cut to fit", () => {
  const folder = "a".repeat(200);
  const saved = candidateKey(folder, "codex", 1);
  const spec = copy("codex", "other", folder);
  assert.equal(cloudSkillKeys([spec], [{ key: folder, name: folder }, { key: saved, name: "other" }]).get(spec), saved);
});
