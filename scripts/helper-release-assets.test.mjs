import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadHelperReleaseManifest,
  validateHelperReleaseManifest,
  verifyHelperReleaseAssets,
  verifyLiveHelperReleaseAssets,
} from "./helper-release-assets.mjs";

const disabled = { version: 1, enabled: false, assets: [] };
const feedPath = "helper/updates/appcast.xml";
const oldDmg = "helper/updates/OMGSkills-Helper-0.1.0-1-arm64.dmg";
const newDmg = "helper/updates/OMGSkills-Helper-0.1.1-2-arm64.dmg";
const bytes = new Map([
  [feedPath, Buffer.from(`<rss><enclosure url="https://omgskills.com/${newDmg}"/></rss>\n`)],
  [oldDmg, Buffer.from("synthetic old helper archive")],
  [newDmg, Buffer.from("synthetic new helper archive")],
]);
const manifest = {
  version: 1,
  enabled: true,
  assets: [...bytes].map(([file, content]) => ({
    path: file, size: content.length, sha256: createHash("sha256").update(content).digest("hex"),
  })),
};
const noFetch = async () => { assert.fail("unexpected helper network request"); };

async function fixture(t, { populated = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "omgskills-helper-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (populated) {
    await mkdir(path.join(root, "helper/updates"), { recursive: true });
    for (const [name, content] of bytes) await writeFile(path.join(root, name), content);
  }
  return root;
}

function fixtureFetch(calls = []) {
  return async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers["Accept-Encoding"], "identity");
    const content = bytes.get(new URL(url).pathname.slice(1));
    assert.ok(content, `unexpected URL: ${url}`);
    return new Response(content, { headers: { "Content-Length": String(content.length) } });
  };
}

test("loads and validates the tracked helper inventory by default", async () => {
  const tracked = JSON.parse(await readFile(new URL("../config/helper-release.json", import.meta.url), "utf8"));
  assert.deepEqual(await loadHelperReleaseManifest(), validateHelperReleaseManifest(tracked));
});

for (const reviewed of [disabled, manifest]) {
  test(`loads an explicit ${reviewed.enabled ? "enabled" : "disabled"} inventory`, async (t) => {
    const root = await fixture(t);
    const file = path.join(root, "manifest.json");
    await writeFile(file, JSON.stringify(reviewed));
    assert.deepEqual(await loadHelperReleaseManifest(file), reviewed);
  });
}

test("missing and malformed inventory fail instead of disabling protection", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "manifest.json");
  await assert.rejects(loadHelperReleaseManifest(file), /Cannot read helper release inventory/);
  await writeFile(file, "not JSON");
  await assert.rejects(loadHelperReleaseManifest(file), /Cannot read helper release inventory/);
  await writeFile(file, JSON.stringify({ ...disabled, extra: true }));
  await assert.rejects(loadHelperReleaseManifest(file), /Invalid helper release inventory/);
});

test("inventory accepts only the exact reviewed schema and fixed paths", () => {
  assert.deepEqual(validateHelperReleaseManifest(manifest), manifest);
  const invalid = [
    null, [], {}, { ...disabled, version: 2 }, { ...disabled, enabled: "false" },
    { ...disabled, assets: manifest.assets }, { ...manifest, assets: [] },
    { ...manifest, assets: [manifest.assets[0]] },
    { ...manifest, assets: [manifest.assets[1]] },
    { ...manifest, assets: [...manifest.assets, manifest.assets[1]] },
    { ...manifest, assets: [null] },
  ];
  for (const value of invalid) assert.throws(() => validateHelperReleaseManifest(value), /helper release/i);
  for (const replacement of [
    { path: "../appcast.xml" }, { path: "/helper/updates/appcast.xml" },
    { path: "helper/updates/../appcast.xml" }, { path: "helper/updates/%2e%2e/appcast.xml" },
    { path: "helper\\updates\\appcast.xml" }, { path: "https://evil.test/appcast.xml" },
    { path: "updates/omgskills.zip" }, { path: "helper/updates/Appcast.xml" },
    { path: "helper/updates/private.pem" }, { path: "helper/updates/appcast.xml?token=x" },
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 },
    { size: "20" }, { sha256: "a" }, { sha256: "A".repeat(64) }, { extra: true },
  ]) {
    assert.throws(() => validateHelperReleaseManifest({
      ...manifest, assets: [{ ...manifest.assets[0], ...replacement }, ...manifest.assets.slice(1)],
    }), /Invalid helper release asset/);
  }
});

test("disabled protection does not fetch or create helper directories", async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await verifyHelperReleaseAssets(root, { manifest: disabled, allowRestore: true, fetchImpl: noFetch }), []);
  await assert.rejects(access(path.join(root, "helper")), { code: "ENOENT" });
  await verifyLiveHelperReleaseAssets({ manifest: disabled, fetchImpl: noFetch });
  await mkdir(path.join(root, "helper/updates"), { recursive: true });
  await writeFile(path.join(root, feedPath), "accidental feed");
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest: disabled, fetchImpl: noFetch }), /Unexpected helper release file/);
});

test("exact assets pass without rewriting bytes or touching Mac releases", async (t) => {
  const root = await fixture(t, { populated: true });
  const legacy = ["appcast.xml", "downloads/omgskills-mac.dmg", "updates/omgskills.zip"];
  for (const name of legacy) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), `Mac sentinel ${name}`);
  }
  const before = await lstat(path.join(root, feedPath));
  assert.deepEqual(await verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: noFetch }), [...bytes.keys()]);
  const after = await lstat(path.join(root, feedPath));
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  for (const name of legacy) assert.equal(await readFile(path.join(root, name), "utf8"), `Mac sentinel ${name}`);
});

test("missing local assets fail without network access or automatic repair", async (t) => {
  const root = await fixture(t);
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest, fetchImpl: noFetch }), /Missing helper release assets/);
  await assert.rejects(access(path.join(root, "helper")), { code: "ENOENT" });
});

test("CI restores every pinned file including an old version not in the feed", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "appcast.xml"), "Mac feed sentinel");
  const calls = [];
  await verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: fixtureFetch(calls) });
  assert.deepEqual(calls, [...bytes.keys()].map((name) => `https://omgskills.com/${name}`));
  for (const [name, content] of bytes) assert.deepEqual(await readFile(path.join(root, name)), content);
  assert.equal(await readFile(path.join(root, "appcast.xml"), "utf8"), "Mac feed sentinel");
  assert.deepEqual((await readdir(path.join(root, "helper/updates"))).sort(), [...bytes.keys()].map((name) => path.basename(name)).sort());
  await verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: noFetch });
});

for (const corrupted of [Buffer.from("bad"), Buffer.alloc(bytes.get(oldDmg).length, 120)]) {
  test(`preexisting corruption (${corrupted.length} bytes) blocks even CI restoration`, async (t) => {
    const root = await fixture(t, { populated: true });
    await writeFile(path.join(root, oldDmg), corrupted);
    await rm(path.join(root, feedPath));
    await assert.rejects(verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: noFetch }), /Helper release (size|checksum) mismatch/);
    assert.deepEqual(await readFile(path.join(root, oldDmg)), corrupted);
    await assert.rejects(access(path.join(root, feedPath)), { code: "ENOENT" });
  });
}

test("undeclared files, links and nonregular files are refused", async (t) => {
  const root = await fixture(t, { populated: true });
  const extra = path.join(root, "helper/updates/secret.pem");
  await writeFile(extra, "synthetic secret");
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest }), /Unexpected helper release file/);
  await rm(extra);
  const file = path.join(root, oldDmg);
  await rm(file);
  await symlink(path.join(root, newDmg), file);
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest }), /Unsafe helper release file/);
  await rm(file);
  await mkdir(file);
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest }), /Unsafe helper release file/);
});

for (const linkedPart of ["helper", "helper/updates"]) {
  test(`refuses a symlinked ${linkedPart} directory`, async (t) => {
    const root = await fixture(t);
    const outside = path.join(root, "outside");
    await mkdir(outside);
    if (linkedPart.includes("/")) await mkdir(path.join(root, "helper"));
    await symlink(outside, path.join(root, linkedPart));
    await assert.rejects(verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: noFetch }), /Unsafe helper release directory/);
    assert.deepEqual(await readdir(outside), []);
  });
}

test("an interrupted prior staging directory fails closed without deleting it", async (t) => {
  const root = await fixture(t, { populated: true });
  await mkdir(path.join(root, "helper/updates/.restore-abandoned"));
  await assert.rejects(verifyHelperReleaseAssets(root, { manifest, allowRestore: true, fetchImpl: noFetch }), /Unexpected helper release file/);
  await access(path.join(root, "helper/updates/.restore-abandoned"));
});

const badResponses = [
  ["404", () => new Response("missing", { status: 404 })],
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } })],
  ["HTML 200", () => new Response("<html>fallback</html>")],
  ["same-size wrong hash", () => new Response(Buffer.alloc(bytes.get(newDmg).length, 120))],
  ["truncated stream", () => new Response(bytes.get(newDmg).subarray(0, 3))],
  ["oversized stream", () => new Response(Buffer.alloc(bytes.get(newDmg).length + 1))],
  ["wrong declared size", () => new Response(bytes.get(newDmg), { headers: { "Content-Length": "1" } })],
  ["interrupted stream", () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); },
    pull(controller) { controller.error(new Error("interrupted stream")); },
  }))],
  ["timeout", () => { throw new DOMException("timeout", "TimeoutError"); }],
];
for (const [label, response] of badResponses) {
  test(`${label} leaves no restored targets or temporary files`, async (t) => {
    const root = await fixture(t);
    const validFetch = fixtureFetch();
    await assert.rejects(verifyHelperReleaseAssets(root, {
      manifest, allowRestore: true,
      fetchImpl: async (url, options) => url.endsWith(newDmg) ? response() : validFetch(url, options),
    }), /fetch helper|mismatch|interrupted stream|timeout/);
    assert.deepEqual(await readdir(path.join(root, "helper/updates")), []);
  });
}

test("a concurrent destination is never overwritten during restoration", async (t) => {
  const root = await fixture(t);
  const validFetch = fixtureFetch();
  await assert.rejects(verifyHelperReleaseAssets(root, {
    manifest, allowRestore: true,
    fetchImpl: async (url, options) => {
      if (url.endsWith(newDmg)) await writeFile(path.join(root, oldDmg), "concurrent file");
      return validFetch(url, options);
    },
  }), { code: "EEXIST" });
  assert.equal(await readFile(path.join(root, oldDmg), "utf8"), "concurrent file");
  assert.equal((await readdir(path.join(root, "helper/updates"))).some((name) => name.startsWith(".restore-")), false);
});

test("live verification reads exact bytes from the candidate origin", async () => {
  const calls = [];
  await verifyLiveHelperReleaseAssets({ origin: "https://candidate.test/", manifest, fetchImpl: fixtureFetch(calls) });
  assert.deepEqual(calls, [...bytes.keys()].map((name) => `https://candidate.test/${name}`));
  await assert.rejects(verifyLiveHelperReleaseAssets({
    manifest, fetchImpl: async () => new Response(Buffer.alloc(bytes.get(feedPath).length, 120)),
  }), /checksum mismatch/);
  for (const origin of ["http://candidate.test", "https://user:password@candidate.test", "https://candidate.test/path", "https://candidate.test/?token=x"]) {
    await assert.rejects(verifyLiveHelperReleaseAssets({ origin, manifest, fetchImpl: noFetch }), /requires an HTTPS origin/);
  }
});
