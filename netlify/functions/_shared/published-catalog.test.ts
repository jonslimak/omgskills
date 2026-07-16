import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublishedCatalogIdentityLoader,
  fetchPublishedCatalogIdentity,
  fetchPublishedSkills,
} from "./published-catalog.js";

type FixtureResponse = {
  body: unknown;
  status?: number;
};

function fixtureFetcher(fixtures: Record<string, FixtureResponse>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const fixture = fixtures[url];
    if (!fixture) {
      return new Response("missing fixture", { status: 404 });
    }
    return Response.json(fixture.body, { status: fixture.status ?? 200 });
  }) as typeof fetch;
}

test("loads published skills from the first available track", async () => {
  const manifestUrl = "https://example.test/crawl4/manifest.json";
  const skillsUrl = "https://example.test/crawl4/skills.json";
  const skills = await fetchPublishedSkills({
    tracks: [{ name: "crawl4", manifestUrl }],
    fetcher: fixtureFetcher({
      [manifestUrl]: { body: { skills: { path: "skills.json" } } },
      [skillsUrl]: { body: [{ id: "owner/repo:skill", name: "skill" }] },
    }),
  });

  assert.deepEqual(skills, [{ id: "owner/repo:skill", name: "skill" }]);
});

test("falls back as one unit instead of mixing skills and SHA history across tracks", async () => {
  const crawlManifest = "https://example.test/crawl4/manifest.json";
  const v2Manifest = "https://example.test/v2/manifest.json";
  const calls: string[] = [];
  const identity = await fetchPublishedCatalogIdentity({
    tracks: [
      { name: "crawl4", manifestUrl: crawlManifest },
      { name: "v2", manifestUrl: v2Manifest },
    ],
    fetcher: fixtureFetcher({
      [crawlManifest]: {
        body: {
          skills: { path: "skills.json" },
          shaHistory: { path: "sha-history.json" },
        },
      },
      "https://example.test/crawl4/skills.json": {
        body: [{ id: "crawl/repo:skill" }],
      },
      "https://example.test/crawl4/sha-history.json": {
        body: { error: "unavailable" },
        status: 500,
      },
      [v2Manifest]: {
        body: {
          skills: { path: "skills.json" },
          shaHistory: { path: "sha-history.json" },
        },
      },
      "https://example.test/v2/skills.json": {
        body: [{ id: "v2/repo:skill" }],
      },
      "https://example.test/v2/sha-history.json": {
        body: {
          version: 1,
          shaToSkillIds: { ["a".repeat(40)]: ["v2/repo:skill"] },
        },
      },
    }, calls),
  });

  assert.equal(identity.track, "v2");
  assert.deepEqual([...identity.liveSkillIds], ["v2/repo:skill"]);
  assert.deepEqual(identity.shaHistory?.shaToSkillIds["a".repeat(40)], ["v2/repo:skill"]);
  assert.ok(calls.includes("https://example.test/crawl4/skills.json"));
  assert.ok(calls.includes("https://example.test/v2/sha-history.json"));
});

test("rejects manifest assets that leave the manifest origin", async () => {
  await assert.rejects(
    fetchPublishedCatalogIdentity({
      tracks: [{ name: "crawl4", manifestUrl: "https://example.test/crawl4/manifest.json" }],
      fetcher: fixtureFetcher({
        "https://example.test/crawl4/manifest.json": {
          body: { skills: { path: "https://attacker.test/skills.json" } },
        },
      }),
    }),
    /identity unavailable/,
  );
});

test("briefly caches successful identity loads and retries after expiry", async () => {
  const manifestUrl = "https://example.test/crawl4/manifest.json";
  const calls: string[] = [];
  let now = 1_000;
  const load = createPublishedCatalogIdentityLoader({
    tracks: [{ name: "crawl4", manifestUrl }],
    fetcher: fixtureFetcher({
      [manifestUrl]: {
        body: {
          skills: { path: "skills.json" },
          shaHistory: { path: "sha-history.json" },
        },
      },
      "https://example.test/crawl4/skills.json": {
        body: [{ id: "owner/repo:skill" }],
      },
      "https://example.test/crawl4/sha-history.json": {
        body: { version: 1, shaToSkillIds: {} },
      },
    }, calls),
    now: () => now,
    cacheMs: 100,
  });

  await load();
  await load();
  assert.equal(calls.filter((url) => url === manifestUrl).length, 1);

  now += 101;
  await load();
  assert.equal(calls.filter((url) => url === manifestUrl).length, 2);
});
