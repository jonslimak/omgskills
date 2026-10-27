import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { catalogTracks, loadDefaultCatalog } from "../src/catalog-tracks.js";

const keys = ["OMGSKILLS_SKILLS_PATH", "OMGSKILLS_TRENDING_PATH", "OMGSKILLS_GOLD_BASKET_PATH", "OMGSKILLS_MANIFEST_URL", "OMGSKILLS_GOLD_BASKET_URL"] as const;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
const remote = {
  id: "remote/repo:example", name: "example", description: "Remote fixture skill.",
  github_url: "https://github.com/remote/repo", install_cmd: "legacy", author_handle: "remote"
};

function setup(context: TestContext, overrides: Partial<Record<typeof keys[number], string>> = {}, unavailable: string[] = []) {
  const previous = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, overrides);
  context.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", (async input => {
    const url = String(input);
    requests.push(url);
    if (unavailable.includes(url)) return new Response("Unavailable", { status: 503 });
    if (url.endsWith("/manifest.json")) return Response.json({ skills: { path: "remote-skills.json" }, trending: { path: "remote-trending.json" } });
    if (url.endsWith("/remote-skills.json")) return Response.json([remote]);
    if (url.endsWith("/remote-trending.json")) return Response.json([{ id: remote.id, trending_rank: 1 }]);
    if (url.endsWith("/index/gold-basket.json")) return Response.json([]);
    throw new Error(`Unexpected fixture request: ${url}`);
  }) as typeof fetch);
  return requests;
}

test("default catalogs fall back newest first without contacting later tracks after success", async context => {
  const requests = setup(context, {}, [catalogTracks[0].manifestUrl]);
  const library = await loadDefaultCatalog();
  assert.ok(await library.getSkill(remote.id));
  assert.deepEqual(requests.filter(url => url.endsWith("/manifest.json")), catalogTracks.slice(0, 2).map(track => track.manifestUrl));
});

test("an explicit manifest does not silently fall back to another catalog", async context => {
  const manifest = "https://fixture.test/custom/manifest.json";
  const requests = setup(context, { OMGSKILLS_MANIFEST_URL: manifest }, [manifest]);
  await assert.rejects(loadDefaultCatalog(), /Catalog fetch failed/);
  assert.deepEqual(requests, [manifest]);
});

test("all three local file overrides remain entirely offline", async context => {
  const requests = setup(context, {
    OMGSKILLS_SKILLS_PATH: fixture("skills"), OMGSKILLS_TRENDING_PATH: fixture("trending"), OMGSKILLS_GOLD_BASKET_PATH: fixture("gold-basket")
  });
  const library = await loadDefaultCatalog();
  assert.ok(await library.getSkill("openai/codex:mcp-builder"));
  assert.equal((await library.listGoldBasket()).length, 1);
  assert.deepEqual(requests, []);
});

test("a skills-only override is honored while other data uses the chosen manifest", async context => {
  const requests = setup(context, { OMGSKILLS_SKILLS_PATH: fixture("skills") });
  const library = await loadDefaultCatalog();
  assert.ok(await library.getSkill("openai/codex:mcp-builder"));
  assert.equal(await library.getSkill(remote.id), undefined);
  assert.ok(requests.includes(catalogTracks[0].manifestUrl));
  assert.ok(!requests.some(url => url.endsWith("/remote-skills.json")));
});

test("a trending-only override replaces the remote trending data", async context => {
  const requests = setup(context, { OMGSKILLS_TRENDING_PATH: fixture("trending") });
  const library = await loadDefaultCatalog();
  assert.ok(await library.getSkill(remote.id));
  assert.deepEqual((await library.listTrending()).map(skill => skill.id), ["openai/codex:mcp-builder", "anthropics/skills:swift-review"]);
  assert.ok(!requests.some(url => url.endsWith("/remote-trending.json")));
});

test("a curated-file override is honored without requiring skills and trending overrides", async context => {
  setup(context, { OMGSKILLS_GOLD_BASKET_PATH: fixture("gold-basket") });
  const library = await loadDefaultCatalog();
  assert.equal((await library.listGoldBasket())[0]?.id, "anthropics/skills:swift-review");
});

test("a missing configured local file fails instead of silently using remote skills", async context => {
  setup(context, { OMGSKILLS_SKILLS_PATH: fixture("does-not-exist") });
  await assert.rejects(loadDefaultCatalog(), { code: "ENOENT" });
});
