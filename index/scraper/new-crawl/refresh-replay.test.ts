import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
