import assert from "node:assert/strict";
import test from "node:test";
import { OmgskillsLibrary } from "../../../mcp/src/library.js";
import { createMcpLibraryLoader } from "./mcp-library.js";

function library(id: string) {
  return OmgskillsLibrary.fromData({
    skills: [{
      id,
      name: id.split(":").at(-1) ?? id,
      description: "A test skill.",
      github_url: "https://github.com/example/skills",
      install_cmd: "npx skills add example/skills",
      author_handle: "example"
    }],
    trending: [],
    goldBasket: []
  });
}

test("falls back through published catalog tracks", async () => {
  const attempts: string[] = [];
  const loader = createMcpLibraryLoader({
    tracks: [
      { name: "crawl4", manifestUrl: "https://example.test/crawl4.json" },
      { name: "v2", manifestUrl: "https://example.test/v2.json" }
    ],
    loadTrack: async (track) => {
      attempts.push(track.name);
      if (track.name === "crawl4") throw new Error("crawl4 unavailable");
      return library("example/skills:v2");
    }
  });

  const snapshot = await loader.get();
  assert.equal(snapshot.sourceTrack, "v2");
  assert.equal(snapshot.skillCount, 1);
  assert.deepEqual(attempts, ["crawl4", "v2"]);
});

test("loads a required skills asset when optional manifest data is absent", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/data/manifest.json") {
      return Response.json({ skills: { path: "skills.json" } });
    }
    if (url === "https://example.test/data/skills.json") {
      return Response.json([{
        id: "example/skills:remote",
        name: "remote",
        description: "A remote skill.",
        github_url: "https://github.com/example/skills",
        install_cmd: "npx skills add example/skills",
        author_handle: "example"
      }]);
    }
    return new Response("missing", { status: 404 });
  };

  const loaded = await OmgskillsLibrary.load({
    manifestUrl: "https://example.test/data/manifest.json",
    fetcher,
    allowMissingTrending: true,
    allowMissingGoldBasket: true
  });
  assert.deepEqual(loaded.getStats(), { skills: 1, trending: 0, goldBasket: 0 });
});

test("reuses a fresh snapshot", async () => {
  let loads = 0;
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    loadTrack: async () => {
      loads += 1;
      return library("example/skills:cached");
    }
  });

  await loader.get();
  await loader.get();
  assert.equal(loads, 1);
});

test("serves stale data while refreshing in the background", async () => {
  let now = 1_000;
  let loads = 0;
  let releaseRefresh: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    maxAgeMs: 100,
    now: () => now,
    loadTrack: async () => {
      loads += 1;
      if (loads === 2) await refreshGate;
      return library(`example/skills:version-${loads}`);
    }
  });

  const first = await loader.get();
  now += 101;
  const stale = await loader.get();
  assert.equal(stale.loadedAt, first.loadedAt);
  assert.equal(loader.status().refreshing, true);

  releaseRefresh?.();
  await loader.pendingRefresh();
  const refreshed = await loader.get();
  assert.equal(refreshed.library.getSkill("example/skills:version-2")?.id, "example/skills:version-2");
});

test("keeps the last-known-good snapshot after refresh failure", async () => {
  let now = 1_000;
  let loads = 0;
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    maxAgeMs: 100,
    now: () => now,
    loadTrack: async () => {
      loads += 1;
      if (loads > 1) throw new Error("refresh failed");
      return library("example/skills:stable");
    }
  });

  const first = await loader.get();
  now += 101;
  const stale = await loader.get();
  await loader.pendingRefresh();
  assert.equal(stale.library.getSkill("example/skills:stable")?.id, "example/skills:stable");
  assert.equal(loader.status().lastRefreshFailed, true);
  assert.equal((await loader.get()).loadedAt, first.loadedAt);
});

test("fails closed when no catalog has ever loaded", async () => {
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    loadTrack: async () => { throw new Error("unavailable"); }
  });

  await assert.rejects(loader.get(), /unavailable/);
  assert.equal(loader.status().hasSnapshot, false);
});
