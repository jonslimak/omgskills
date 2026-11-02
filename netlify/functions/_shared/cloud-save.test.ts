import assert from "node:assert/strict";
import test from "node:test";
import { CloudSaveError, normalizeSkillKey, parseCloudManifest, parseCloudSaveSettingsUpdate } from "./cloud-save.js";
import { cloudBlobKey, createCloudObjectStore, signS3Request } from "./cloud-store.js";
import { gitObjectSha, validateSkillManifest, validateSkillPackage, type SkillPackage } from "./skill-package.js";
import { portalCloudSave } from "../portal-cloud-save.mjs";

const unused = () => { throw new Error("not used"); };

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    available: () => true,
    pool: unused,
    store: unused,
    requireUser: unused,
    requireDevice: unused,
    ...overrides
  } as never;
}

const call = (method: string, route: string, deps = dependencies(), headers: Record<string, string> = {}) =>
  portalCloudSave(new Request(`https://omgskills.com/api/portal/cloud-save${route}`, { method, headers }), {} as never, deps);

test("cloud save answers 503 until it is turned on", async () => {
  const response = await call("GET", "", dependencies({ available: () => false }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "unavailable");
});

test("unknown routes and methods are refused before any sign-in check", async () => {
  assert.equal((await call("GET", "/nothing")).status, 404);
  assert.equal((await call("GET", "/versions/not-an-id/package")).status, 404);
  assert.equal((await call("GET", "/versions/aaaaaaaaaaaaaaaa/package")).status, 404);
  assert.equal((await call("DELETE", "/settings")).status, 405);
  assert.equal((await call("GET", "/blobs/abc")).status, 405);
});

test("a device credential selects device sign-in; anything else is a web session", async () => {
  const seen: string[] = [];
  const deps = dependencies({
    pool: () => ({ query: async () => ({ rows: [{ bytes: "0" }], rowCount: 0 }) }),
    requireUser: async () => { seen.push("user"); return { userId: "u", deviceId: null }; },
    requireDevice: async (_req: Request, scope: string) => { seen.push(scope); return { userId: "u", deviceId: "d" }; }
  });
  await call("GET", "", deps, { authorization: `Bearer device_${"a".repeat(43)}` });
  await call("GET", "", deps, { authorization: "Bearer eyJhbGciOi.clerk.token" });
  assert.deepEqual(seen, ["sync:write", "user"]);
});

test("uploads need a device even when a web session is present", async () => {
  const deps = dependencies({
    requireUser: unused,
    requireDevice: async () => { throw new CloudSaveError("disabled", "Cloud save is turned off"); }
  });
  const response = await call("PUT", `/blobs/${"a".repeat(40)}`, deps);
  assert.equal(response.status, 403);
});

test("skill keys are folder names compared without case, and odd names are refused, not trimmed", () => {
  assert.equal(normalizeSkillKey("PDF-Tools"), "pdf-tools");
  assert.equal(normalizeSkillKey("Cafe\u0301 Notes"), "café notes");
  for (const bad of ["", ".", "..", ".hidden", "a/b", "a\\b", "x\u0000", "x\u0085y", "\uFEFFx", "x\u200B", "x\u2028",
    " padded", "padded ", "x".repeat(201), 3]) {
    assert.throws(() => normalizeSkillKey(bad), CloudSaveError);
  }
});

test("settings updates take only known fields", () => {
  assert.deepEqual(parseCloudSaveSettingsUpdate({ enabled: true }), { enabled: true });
  assert.deepEqual(parseCloudSaveSettingsUpdate({ excludedSkillKeys: ["B", "a", "b"] }), { excludedSkillKeys: ["a", "b"] });
  assert.throws(() => parseCloudSaveSettingsUpdate({}), CloudSaveError);
  assert.throws(() => parseCloudSaveSettingsUpdate({ enabled: "yes" }), CloudSaveError);
  assert.throws(() => parseCloudSaveSettingsUpdate({ excludedSkillKeys: "a" }), CloudSaveError);
});

test("a manifest's tree hash matches the hash of the package it describes", () => {
  const files = [
    { path: "SKILL.md", mode: "100644", data: Buffer.from("# Skill\n") },
    { path: "lib/a.py", mode: "100644", data: Buffer.from("print(1)\n") },
    { path: "lib/b.sh", mode: "100755", data: Buffer.from("echo\n") }
  ].map((file) => ({ ...file, blobSha: gitObjectSha("blob", file.data) }));
  const entries = parseCloudManifest({ files: files.map(({ path, mode, blobSha, data }) => ({ path, mode, blobSha, byteSize: data.byteLength })) });
  const manifest = validateSkillManifest(entries);
  const skillPackage: SkillPackage = {
    coordinates: { commitSha: manifest.treeSha, treeSha: manifest.treeSha, skillMdSha: manifest.skillMdSha },
    entries: files
  };
  assert.equal(validateSkillPackage(skillPackage, skillPackage.coordinates).fileCount, 3);
  assert.throws(() => validateSkillManifest([...entries, { ...entries[1], path: "LIB/a.py" }]), /case_collision/);
  assert.throws(() => validateSkillManifest([{ ...entries[1], path: "../x" }]), /invalid_path/);
  assert.throws(() => validateSkillManifest([{ ...entries[0], mode: "120000" }]), /symbolic_link/);
});

test("the object store signs requests and never sends files to another user's key", async () => {
  assert.equal(cloudBlobKey("user-1", "b".repeat(40)), `cloud/user-1/${"b".repeat(40)}`);
  assert.throws(() => createCloudObjectStore(() => undefined), /not configured/);
  const requests: { url: string; init: RequestInit }[] = [];
  const env: Record<string, string> = {
    CLOUD_SAVE_R2_ACCOUNT_ID: "acct",
    CLOUD_SAVE_R2_ACCESS_KEY_ID: "key-id",
    CLOUD_SAVE_R2_SECRET_ACCESS_KEY: "secret",
    CLOUD_SAVE_R2_BUCKET: "omgskills-cloud-save"
  };
  const store = createCloudObjectStore((key) => env[key], (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(init.method === "GET" ? "data" : null, { status: 200 });
  }) as typeof fetch);
  await store.put("cloud/u/abc", Buffer.from("data"));
  assert.equal((await store.get("cloud/u/abc")).toString(), "data");
  assert.equal(requests[0].url, "https://acct.r2.cloudflarestorage.com/omgskills-cloud-save/cloud/u/abc");
  const headers = requests[0].init.headers as Record<string, string>;
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(requests), /secret/);

  const fixed = signS3Request({
    method: "GET", host: "h", path: "/b/k", payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    accessKeyId: "id", secretAccessKey: "s", now: new Date("2026-11-02T00:00:00Z")
  });
  assert.equal(fixed["x-amz-date"], "20261102T000000Z");
});
