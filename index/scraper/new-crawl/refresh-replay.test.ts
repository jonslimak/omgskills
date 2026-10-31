import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildRefreshReplayPath,
  createRefreshReplayStoreFromEnv,
  RefreshReplayError,
  refreshReplayEnv,
  RefreshReplayStore,
} from "./refresh-replay.js";

test("buildRefreshReplayPath is stable for key and kind", () => {
  const root = "/tmp/replay";
  assert.equal(
    buildRefreshReplayPath(root, "repo-meta", "owner/repo"),
    buildRefreshReplayPath(root, "repo-meta", "owner/repo"),
  );
  assert.notEqual(
    buildRefreshReplayPath(root, "repo-meta", "owner/repo"),
    buildRefreshReplayPath(root, "tree", "owner/repo"),
  );
});

test("record then replay returns saved repo meta, tree, and raw file entries", async () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-replay-"));
  try {
    const recorder = new RefreshReplayStore("record", root);
    const recordedMeta = await recorder.repoMeta("owner/repo", async () => ({
      stars: 10,
      lastUpdated: "2026-06-03T00:00:00Z",
      tags: ["a"],
      githubUrl: "https://github.com/owner/repo",
    }));
    const recordedTree = await recorder.tree("owner/repo@main", async () => ["skills/a/SKILL.md"]);
    const recordedRaw = await recorder.rawFile("owner/repo@main:skills/a/SKILL.md", async () => ({
      content: "body",
      sha: "sha",
    }));

    const replayer = new RefreshReplayStore("replay", root);
    assert.deepEqual(await replayer.repoMeta("owner/repo", async () => { throw new Error("should not load live"); }), recordedMeta);
    assert.deepEqual(await replayer.tree("owner/repo@main", async () => { throw new Error("should not load live"); }), recordedTree);
    assert.deepEqual(
      await replayer.rawFile("owner/repo@main:skills/a/SKILL.md", async () => { throw new Error("should not load live"); }),
      recordedRaw,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replay preserves null raw file responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-replay-"));
  try {
    const recorder = new RefreshReplayStore("record", root);
    assert.equal(await recorder.rawFile("owner/repo@main:missing/SKILL.md", async () => null), null);

    const replayer = new RefreshReplayStore("replay", root);
    assert.equal(await replayer.rawFile("owner/repo@main:missing/SKILL.md", async () => ({ content: "x", sha: "y" })), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replay rethrows recorded errors and fails on missing entries", async () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-replay-"));
  try {
    const recorder = new RefreshReplayStore("record", root);
    await assert.rejects(
      recorder.tree("owner/repo@main", async () => {
        const error = new Error("boom") as Error & { status?: number };
        error.status = 404;
        throw error;
      }),
    );

    const replayer = new RefreshReplayStore("replay", root);
    await assert.rejects(
      replayer.tree("owner/repo@main", async () => []),
      (error: unknown) => error instanceof RefreshReplayError && error.status === 404 && error.message === "boom",
    );
    await assert.rejects(
      replayer.repoMeta("missing/repo", async () => ({
        stars: 0,
        lastUpdated: "2026-06-03T00:00:00Z",
        tags: [],
        githubUrl: "https://github.com/missing/repo",
      })),
      /missing refresh replay entry/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refreshReplayEnv and createRefreshReplayStoreFromEnv round-trip", () => {
  const root = "/tmp/replay";
  const env = refreshReplayEnv("replay", root);
  const store = createRefreshReplayStoreFromEnv(env);

  assert.equal(store.mode, "replay");
  assert.equal(store.root, root);
});

test("input replay preserves discovery Maps, Sets, order, and optional fields without loading live feeds", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "discovery-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const value = {
    discovered: new Map([
      ["second/repo", { sources: new Set(["skillssh", "registry"]), bootstrapCandidate: undefined }],
      ["first/repo", { sources: new Set(["official"]), bootstrapCandidate: undefined }],
    ]),
    momentum: new Map([["second/repo", new Set(["skillssh", "validatedX"])]]),
    checkedAt: "2026-10-31T18:00:00.000Z",
  };
  const recorder = new RefreshReplayStore("record", root);
  assert.strictEqual(await recorder.input("discovery:combined", async () => value), value);
  const replayer = new RefreshReplayStore("replay", root);
  const replayed = await replayer.input<typeof value>("discovery:combined", async () => {
    assert.fail("replay must not fetch changing live feeds");
  });
  assert.deepEqual(replayed, value);
  assert.deepEqual([...replayed.discovered.keys()], ["second/repo", "first/repo"]);
});

test("input recording is disabled during normal crawls", async () => {
  const store = new RefreshReplayStore("off", null);
  let calls = 0;
  const value = new Map([["live/repo", new Set(["skillssh"])]]);
  const load = async () => { calls++; return value; };
  assert.strictEqual(await store.input("discovery", load), value);
  assert.strictEqual(await store.input("discovery", load), value);
  assert.equal(calls, 2);
});

test("input replay fails closed on missing, corrupt, or mismatched recordings", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "discovery-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const recorder = new RefreshReplayStore("record", root);
  const replayer = new RefreshReplayStore("replay", root);
  let liveLoads = 0;
  const load = async () => { liveLoads++; return new Map(); };
  await assert.rejects(replayer.input("missing", load), /missing refresh replay entry/);
  assert.equal(existsSync(buildRefreshReplayPath(root, "input", "missing")), false);
  await recorder.input("discovery", async () => new Map());
  const path = buildRefreshReplayPath(root, "input", "discovery");
  for (const entry of [
    "not json",
    JSON.stringify({ key: "other", kind: "ok", value: "" }),
    JSON.stringify({ key: "discovery", kind: "null" }),
    JSON.stringify({ key: "discovery", kind: "ok", value: 123 }),
    JSON.stringify({ key: "discovery", kind: "ok", value: "invalid serialized data" }),
  ]) {
    writeFileSync(path, entry);
    await assert.rejects(replayer.input("discovery", load));
  }
  assert.equal(liveLoads, 0, "invalid recordings must not fall back to live feeds");
});
