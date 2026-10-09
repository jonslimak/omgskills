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

function versionedLibrary(id: string, version: string) {
  const base = library(id);
  return OmgskillsLibrary.fromData({ skills: [base.getSkill(id)!], trending: [], goldBasket: [] }, version);
}

test("refresh keeps the snapshot when the catalog version is unchanged", async () => {
  let clock = 0;
  let loads = 0;
  let versionReads = 0;
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    maxAgeMs: 1000,
    now: () => clock,
    loadTrack: async () => {
      loads += 1;
      return versionedLibrary("example/skills:same", "skills-a.json|trending-a.json");
    },
    readTrackVersion: async () => {
      versionReads += 1;
      return "skills-a.json|trending-a.json";
    }
  });

  const first = await loader.get();
  clock = 5000;
  const refreshed = await loader.refresh();
  assert.equal(loads, 1);
  assert.equal(versionReads, 1);
  assert.equal(refreshed.library, first.library);
  assert.equal(refreshed.loadedAt, 5000);
});

test("refresh reloads when the catalog version changes or cannot be read", async () => {
  let loads = 0;
  let version = "skills-a.json|";
  let failVersionRead = false;
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4.json" }],
    loadTrack: async () => {
      loads += 1;
      return versionedLibrary(`example/skills:v${loads}`, version);
    },
    readTrackVersion: async () => {
      if (failVersionRead) throw new Error("manifest unavailable");
      return version;
    }
  });

  await loader.get();
  version = "skills-b.json|";
  const changed = await loader.refresh();
  assert.equal(loads, 2);
  assert.equal(changed.library.version, "skills-b.json|");

  failVersionRead = true;
  await loader.refresh();
  assert.equal(loads, 3);
});

test("library version covers manifest paths and curated data and matches the loaded snapshot", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/data/manifest.json") {
      return Response.json({ skills: { path: "skills-abc.json" }, trending: { path: "trending-def.json" } });
    }
    return Response.json([]);
  };
  const manifestUrl = "https://example.test/data/manifest.json";
  const version = await OmgskillsLibrary.readVersion(manifestUrl, fetcher);
  assert.match(version ?? "", /^skills-abc\.json\|trending-def\.json\|[a-f0-9]{64}$/);
  assert.equal((await OmgskillsLibrary.load({ manifestUrl, fetcher })).version, version);
});

test("refresh retries the preferred track before reusing an unchanged fallback", async () => {
  let primaryAvailable = false;
  const attempts: string[] = [];
  const loader = createMcpLibraryLoader({
    tracks: [
      { name: "crawl4", manifestUrl: "https://example.test/crawl4.json" },
      { name: "v2", manifestUrl: "https://example.test/v2.json" }
    ],
    loadTrack: async (track) => {
      attempts.push(track.name);
      if (track.name === "crawl4" && !primaryAvailable) throw new Error("temporary failure");
      return versionedLibrary(`example/skills:${track.name}`, track.name);
    },
    readTrackVersion: async (track) => track.name
  });

  const fallback = await loader.get();
  assert.equal(fallback.sourceTrack, "v2");
  assert.equal((await loader.refresh()).library, fallback.library);
  assert.deepEqual(attempts, ["crawl4", "v2", "crawl4"]);
  primaryAvailable = true;
  assert.equal((await loader.refresh()).sourceTrack, "crawl4");
  assert.deepEqual(attempts, ["crawl4", "v2", "crawl4", "crawl4"]);
});

function remoteCatalog() {
  const manifestUrl = "https://example.test/data/manifest.json";
  const skill = library("example/skills:remote").getSkill("example/skills:remote")!;
  const state = { failTrending: false, failGold: false, goldScore: 10, empty: false, skillReads: 0 };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === manifestUrl) return Response.json({
      skills: { path: "skills-abc.json" }, trending: { path: "trending-def.json" }
    });
    if (url.endsWith("/skills-abc.json")) {
      state.skillReads += 1;
      return Response.json([skill]);
    }
    if (url.endsWith("/trending-def.json")) return state.failTrending
      ? new Response("unavailable", { status: 503 })
      : Response.json(state.empty ? [] : [{ id: skill.id, trending_rank: 1, installs: 5 }]);
    if (url.endsWith("/gold-basket.json")) return state.failGold
      ? new Response("unavailable", { status: 503 })
      : Response.json(state.empty ? [] : [{ ...skill, score: state.goldScore }]);
    throw new Error(`Unexpected request: ${url}`);
  };
  const loader = createMcpLibraryLoader({
    tracks: [{ name: "crawl4", manifestUrl }],
    loadTrack: () => OmgskillsLibrary.load({
      manifestUrl, fetcher, allowMissingTrending: true, allowMissingGoldBasket: true
    }),
    readTrackVersion: () => OmgskillsLibrary.readVersion(manifestUrl, fetcher)
  });
  return { state, loader, skill };
}

for (const source of ["Trending", "Gold"] as const) {
  test(`refresh recovers a failed optional ${source} download without a manifest change`, async () => {
    const { state, loader } = remoteCatalog();
    state[`fail${source}`] = true;
    const first = await loader.get();
    assert.equal(source === "Trending" ? first.trendingCount : first.goldBasketCount, 0);
    assert.equal(first.library.version, undefined);
    state[`fail${source}`] = false;
    const recovered = await loader.refresh();
    assert.equal(source === "Trending" ? recovered.trendingCount : recovered.goldBasketCount, 1);
    assert.equal(state.skillReads, 2);
  });
}

test("refresh picks up independent curated score changes and updates search scoring", async () => {
  const { state, loader, skill } = remoteCatalog();
  const first = await loader.get();
  const oldScore = first.library.searchSkills({ query: "remote" })[0].score;
  state.goldScore = 99;
  const refreshed = await loader.refresh();
  assert.equal(refreshed.library.getSkill(skill.id)?.gold_score, 99);
  assert.ok(refreshed.library.searchSkills({ query: "remote" })[0].score > oldScore);
  assert.equal(state.skillReads, 2);
});

test("unchanged healthy remote data skips the large catalog download", async () => {
  const { state, loader } = remoteCatalog();
  const first = await loader.get();
  assert.equal(first.trendingCount, 1);
  assert.equal(first.goldBasketCount, 1);
  assert.equal((await loader.refresh()).library, first.library);
  assert.equal(state.skillReads, 1);
});

test("successful empty optional data remains cacheable", async () => {
  const { state, loader } = remoteCatalog();
  state.empty = true;
  const first = await loader.get();
  assert.equal((await loader.refresh()).library, first.library);
  assert.equal(state.skillReads, 1);
});
