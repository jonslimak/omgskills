import assert from "node:assert/strict";
import test from "node:test";
import { clearVerifyCache, handleLibraryMcp, issuerFromPublishableKey, type LibraryMcpDependencies, type VerifiedToken } from "./library-mcp.js";
import { buildMySkills } from "./my-skills-library.js";
import type { SavedFile } from "./library-read.js";

const origin = "https://omgskills.test";
const resource = `${origin}/api/library/mcp`;
const now = Date.parse("2026-11-06T12:00:00Z");

const copy = (name: string, extra: Record<string, unknown> = {}) => ({ id: name, name, description: `${name} help`, source: "claude",
  skillMdSha: "a", identityStatus: "localOnly" as const, catalogSkillId: null, githubUrl: null, isLocalOnly: true,
  lastSeenAt: "2026-11-05T00:00:00Z", deviceId: "mac", installationFolder: name, isCurrent: true, ...extra });
const version = (labels: string[] = []) => ({ id: "v", sourceId: "s", commitSha: "c", treeSha: "t", skillMdSha: "m",
  fileCount: 2, totalBytes: 20, deviceId: "mac", savedAt: "2026-11-05T00:00:00.000Z", labels });

function library(userId: string) {
  // Each account has its own library; reading another's would show its skills.
  const name = userId === "user-a" ? "notes" : "b-secret-plans";
  return buildMySkills({
    now,
    inventory: [copy(name), copy("locked"), copy("pdf", { catalogSkillId: "o/r:pdf", isLocalOnly: false, identityStatus: "resolved" })],
    cloud: { settings: { enabled: true, excludedSkillKeys: [] }, usage: { bytes: 0, limitBytes: 1 }, skipped: {},
      skills: [{ key: name, currentVersion: version(), versionCount: 1, deletedLocallyAt: null, setCount: 0 }],
      needsReview: [{ key: "locked", deviceId: "mac", files: [], confirmed: false, updatedAt: "" }] } as never,
    additions: [],
  });
}

const files: SavedFile[] = [
  { path: "SKILL.md", bytes: 10, blobSha: "1", storageKey: null },
  { path: "scripts/run.sh", bytes: 4, blobSha: "2", storageKey: null },
];

function deps(token: Partial<VerifiedToken> | null = {}, overrides: Partial<LibraryMcpDependencies> = {}) {
  clearVerifyCache();
  const calls: string[] = [];
  const value: LibraryMcpDependencies = {
    verifyToken: async () => token === null ? null
      : { subject: "clerk-a", aud: [resource], revoked: false, expired: false, ...token },
    userIdFor: async (clerk) => clerk === "clerk-a" ? "user-a" : clerk === "clerk-b" ? "user-b" : null,
    loadMySkills: async (userId) => { calls.push(`load:${userId}`); return { ...library(userId), partial: [] }; },
    savedFiles: async (userId, key) => { calls.push(`files:${userId}:${key}`); return { files, savedAt: "2026-11-05" }; },
    readSaved: async (_userId, file) => ({ path: file.path, bytes: file.bytes, encoding: "utf8",
      content: file.path === "SKILL.md" ? "---\nname: notes\n---\nTake notes." : "echo", truncated: false }),
    publicSkill: async (id) => ({ id, name: "pdf" } as never),
    readPublicSkillMd: async () => ({ id: "o/r:pdf", path: "pdf/SKILL.md", ref: "abc123abc123abc", pinned: true, verified: true,
      truncated: false, content: "Public pdf skill." }),
    readPublicFile: async (_skill, path) => ({ id: "o/r:pdf", ref: "abc123abc123", path: "pdf", pinned: true,
      files: [{ path, content: "public file" }], listing_truncated: false, skipped_entries: 0 }),
    issuer: () => "https://clerk.omgskills.test",
    ...overrides,
  };
  return { value, calls };
}

const rpc = (method: string, params: unknown, auth = "Bearer token") => new Request(resource, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});

async function call(d: LibraryMcpDependencies, name: string, args: Record<string, unknown>) {
  const response = await handleLibraryMcp(rpc("tools/call", { name, arguments: args }), d);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  return { text: body.result.content[0].text as string, isError: body.result.isError === true };
}

test("publishes where to sign in, for this address", async () => {
  const response = await handleLibraryMcp(new Request(`${origin}/.well-known/oauth-protected-resource/api/library/mcp`), deps().value);
  assert.deepEqual((await response.json()).resource, resource);
  const body = await (await handleLibraryMcp(new Request(`${origin}/.well-known/oauth-protected-resource`), deps().value)).json();
  assert.deepEqual(body.authorization_servers, ["https://clerk.omgskills.test"]);
  const relayed = await handleLibraryMcp(new Request(`${origin}/.well-known/oauth-authorization-server`), deps({}, {
    fetchMetadata: async (url) => { assert.equal(url, "https://clerk.omgskills.test/.well-known/oauth-authorization-server");
      return Response.json({ issuer: "https://clerk.omgskills.test" }); } }).value);
  assert.equal((await relayed.json()).issuer, "https://clerk.omgskills.test");
  assert.equal(issuerFromPublishableKey(`pk_test_${Buffer.from("concise-pangolin-19.clerk.accounts.dev$").toString("base64")}`),
    "https://concise-pangolin-19.clerk.accounts.dev");
  assert.equal(issuerFromPublishableKey("sk_test_nope"), null);
});

test("no token, or one that is revoked, expired or for another address, asks to sign in", async () => {
  const noToken = await handleLibraryMcp(rpc("tools/list", {}, ""), deps().value);
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers.get("www-authenticate")!, /resource_metadata="https:\/\/omgskills\.test\/\.well-known\/oauth-protected-resource\/api\/library\/mcp"/);
  for (const token of [null, { revoked: true }, { expired: true }, { aud: ["https://other.example/mcp"] }, { aud: [] }]) {
    const { value, calls } = deps(token);
    const response = await handleLibraryMcp(rpc("tools/list", {}), value);
    assert.equal(response.status, 401, JSON.stringify(token));
    assert.match(response.headers.get("www-authenticate")!, /error="invalid_token"/);
    assert.deepEqual(calls, [], "Nothing is read");
  }
  let checks = 0;
  const counted = deps(null, { verifyToken: async () => { checks++; return null; } }).value;
  await handleLibraryMcp(rpc("tools/list", {}, "Bearer made-up"), counted);
  await handleLibraryMcp(rpc("tools/list", {}, "Bearer made-up"), counted);
  assert.equal(checks, 1, "A repeated made-up token asks Clerk once");
  const stranger = await handleLibraryMcp(rpc("tools/list", {}), deps({ subject: "clerk-nobody" }).value);
  assert.equal(stranger.status, 403);
});

test("lists the three read tools", async () => {
  const response = await handleLibraryMcp(rpc("tools/list", {}), deps().value);
  const names = (await response.json()).result.tools.map((tool: { name: string }) => tool.name).sort();
  assert.deepEqual(names, ["read_my_skill", "read_skill_file", "search_my_skills"]);
});

test("each account reads only its own library", async () => {
  const a = deps();
  const listed = JSON.parse((await call(a.value, "search_my_skills", {})).text);
  assert.deepEqual(listed.skills.map((skill: { name: string }) => skill.name), ["locked", "notes", "pdf"]);
  assert.equal(listed.skills[0].description, "", "A locked skill's description stays hidden");
  const probe = JSON.parse((await call(a.value, "search_my_skills", { query: "locked help" })).text);
  assert.equal(probe.total, 0, "Searching can't match a locked skill's hidden description");
  assert.deepEqual(a.calls, ["load:user-a"]);
  const b = deps({ subject: "clerk-b" });
  const other = JSON.parse((await call(b.value, "search_my_skills", { query: "notes" })).text);
  assert.equal(other.total, 0, "Account B can't find A's skill");
  const read = await call(b.value, "read_my_skill", { id: "key:notes" });
  assert.equal(read.isError, true);
});

test("reads the synced SKILL.md and listed files; locked skills and unlisted paths are refused", async () => {
  const { value } = deps();
  const read = await call(value, "read_my_skill", { id: "key:notes" });
  assert.equal(read.isError, false);
  assert.match(read.text, /Your synced copy/);
  assert.match(read.text, /name: notes/, "Full SKILL.md with frontmatter");
  assert.match(read.text, /scripts\/run\.sh \(4 bytes\)/);
  assert.equal((await call(value, "read_skill_file", { id: "key:notes", path: "scripts/run.sh" })).isError, false);
  for (const path of ["../other/SKILL.md", "/etc/passwd", "scripts/missing.sh"]) {
    assert.equal((await call(value, "read_skill_file", { id: "key:notes", path })).isError, true, path);
  }
  const locked = await call(value, "read_my_skill", { id: "key:locked" });
  assert.equal(locked.isError, true);
  assert.match(locked.text, /key or password/);
});

test("a library skill with no synced copy reads its labeled public version", async () => {
  const { value } = deps();
  const read = await call(value, "read_my_skill", { id: "lib:o/r:pdf" });
  assert.equal(read.isError, false);
  assert.match(read.text, /Public library version; your Mac copy may differ/);
  assert.match(read.text, /Public pdf skill/);
  assert.match((await call(value, "read_skill_file", { id: "lib:o/r:pdf", path: "pdf/ref.md" })).text, /public file/);
});

test("only POST reaches the tools, and other paths are not found", async () => {
  const get = await handleLibraryMcp(new Request(resource, { headers: { authorization: "Bearer token" } }), deps().value);
  assert.equal(get.status, 405);
  assert.equal((await handleLibraryMcp(new Request(`${origin}/api/library/other`), deps().value)).status, 404);
  assert.equal((await handleLibraryMcp(new Request(resource, { method: "OPTIONS" }), deps().value)).status, 204);
});
