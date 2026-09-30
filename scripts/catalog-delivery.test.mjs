import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));

function json(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function asset(dir, prefix, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${prefix}-${sha256.slice(0, 12)}.json`;
  writeFileSync(join(dir, path), bytes);
  return { path, sha256, bytes: bytes.length };
}

function fixture(t, track) {
  const root = mkdtempSync(join(tmpdir(), "catalog-delivery-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "site/data", track === "v1" ? "" : track);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "index/shadow"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  for (const name of ["publish-data.sh", "publish-crawl4-data.mjs", "publish-catalog-manifest.mjs"]) {
    cpSync(join(scripts, name), join(root, "scripts", name));
  }
  // Health generation is unrelated to catalog retention and has its own tests.
  writeFileSync(join(root, "scripts/build-health.mjs"), "// fixture health stub\n");
  const input = (generation) => {
    const skills = [{ id: "owner/repo:skill", author_handle: "owner", description: generation }];
    json(join(root, "index/skills.json"), skills);
    json(join(root, "index/shadow/skills.cutover.shadow.json"), skills);
    json(join(root, "index/trending.json"), [{ id: skills[0].id }]);
    json(join(root, "index/x-trending.json"), [{ id: skills[0].id }]);
    json(join(root, "index/shadow/shadow-report.json"), {
      checkedAt: "2026-09-29T12:00:00Z", cutoverValidationPassed: true,
    });
  };
  const run = () => spawnSync(track === "crawl4" ? process.execPath : "bash", [
    join(root, "scripts", track === "crawl4" ? "publish-crawl4-data.mjs" : "publish-data.sh"),
  ], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      OMGSKILLS_DATA_SUBDIR: track === "v1" ? "" : track, MANIFEST_GENERATED_AT: "2026-09-29T12:00:00Z" },
  });
  const publish = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  };
  input("A");
  return { root, dir, input, run, publish };
}

for (const track of ["v1", "v2", "crawl4"]) {
  test(`${track}: retain manifest-referenced assets despite misleading timestamps and repeat publishes`, (t) => {
    const f = fixture(t, track);
    const first = f.publish();
    const optional = asset(f.dir, "collections", { collections: [] });
    json(join(f.dir, "manifest.json"), { ...first, collections: optional });
    const orphan = asset(f.dir, "skills", [{ id: "unreferenced" }]);
    utimesSync(join(f.dir, first.skills.path), 1, 1);
    utimesSync(join(f.dir, orphan.path), 2000000000, 2000000000);
    // Similar prefixes must not let the skills/trending cleanup remove other assets.
    const foreign = asset(f.dir, "trending-leaderboard", ["foreign"]);
    f.input("B");
    const second = f.publish();
    assert.ok(existsSync(join(f.dir, first.skills.path)), "previous manifest's skills must survive");
    assert.ok(existsSync(join(f.dir, second.skills.path)), "current skills must survive");
    assert.ok(!existsSync(join(f.dir, orphan.path)), "unreferenced skills should be pruned");
    assert.ok(existsSync(join(f.dir, foreign.path)), "unowned or unchanged prefix must survive");
    assert.deepEqual(second.collections, optional);
    assert.ok(existsSync(join(f.dir, optional.path)));
    f.publish();
    f.publish();
    assert.ok(existsSync(join(f.dir, first.skills.path)), "no-op reruns retain the previous generation");
    f.input("C");
    const third = f.publish();
    assert.deepEqual(readdirSync(f.dir).filter((p) => /^skills-[a-f0-9]{12}\.json$/.test(p)).sort(),
      [second.skills.path, third.skills.path].sort());
    assert.ok(existsSync(join(f.dir, first.trending.path)), "unchanged trending must remain available");
  });

  test(`${track}: missing previous asset fails without replacing the manifest or pruning files`, (t) => {
    const f = fixture(t, track);
    const first = f.publish();
    const manifestBytes = readFileSync(join(f.dir, "manifest.json"));
    rmSync(join(f.dir, first.skills.path));
    const orphan = asset(f.dir, "skills", ["orphan"]);
    f.input("B");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing|ENOENT/i);
    assert.deepEqual(readFileSync(join(f.dir, "manifest.json")), manifestBytes);
    assert.ok(existsSync(join(f.dir, orphan.path)));
  });
}

for (const failure of ["missing", "bytes", "hash", "unsafe-path", "symlink"]) {
  test(`candidate ${failure} fails before manifest activation or cleanup`, (t) => {
    const f = fixture(t, "crawl4");
    const previousManifest = f.publish();
    const before = readFileSync(join(f.dir, "manifest.json"));
    const next = asset(f.dir, "skills", ["next"]);
    const orphan = asset(f.dir, "skills", ["orphan"]);
    if (failure === "missing") rmSync(join(f.dir, next.path));
    if (failure === "bytes") next.bytes += 1;
    if (failure === "hash") next.sha256 = "0".repeat(64);
    if (failure === "unsafe-path") next.path = "../outside.json";
    if (failure === "symlink") {
      rmSync(join(f.dir, next.path));
      symlinkSync(join(f.dir, orphan.path), join(f.dir, next.path));
    }
    assert.throws(() => publishCatalogManifest({
      dataDir: f.dir, manifest: { ...previousManifest, skills: next }, previousManifest,
      prefixes: ["skills", "trending", "x-trending"],
    }), /ENOENT|mismatch|Unsafe|regular file/);
    assert.deepEqual(readFileSync(join(f.dir, "manifest.json")), before);
    assert.ok(existsSync(join(f.dir, orphan.path)));
    assert.ok(!readdirSync(f.dir).some((p) => p.endsWith(".tmp")));
  });
}

test("a removed optional asset remains available to readers of the previous manifest", (t) => {
  const f = fixture(t, "crawl4");
  const previousManifest = f.publish();
  const { xTrending, ...manifest } = previousManifest;
  publishCatalogManifest({
    dataDir: f.dir, manifest, previousManifest, prefixes: ["skills", "trending", "x-trending"],
  });
  assert.ok(existsSync(join(f.dir, xTrending.path)));
  assert.equal(JSON.parse(readFileSync(join(f.dir, "manifest.json"))).xTrending, undefined);
  publishCatalogManifest({
    dataDir: f.dir, manifest, previousManifest: manifest, prefixes: ["skills", "trending", "x-trending"],
  });
  assert.ok(existsSync(join(f.dir, xTrending.path)));
});

test("all mutable data manifests explicitly override immutable caching", () => {
  const config = readFileSync(resolve(scripts, "../netlify.toml"), "utf8");
  const blocks = config.split("[[headers]]").slice(1);
  const broad = blocks.findIndex((b) => b.includes('for = "/data/*"'));
  assert.match(blocks[broad], /max-age=31536000, immutable/);
  for (const path of ["/data/manifest.json", "/data/v2/manifest.json", "/data/crawl4/manifest.json"]) {
    const index = blocks.findIndex((b) => b.includes(`for = "${path}"`));
    assert.ok(index > broad, `${path} must override the broad data rule`);
    assert.match(blocks[index], /Cache-Control = "public, max-age=60, must-revalidate"/);
    assert.doesNotMatch(blocks[index], /immutable/);
  }
});
