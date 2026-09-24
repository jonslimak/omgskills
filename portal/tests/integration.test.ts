import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isIntegrationRead, isIntegrationRequest, isIntegrationBody, testBackendOrigin } from "../integration-config";
import {
  isLocalIntegration,
  integrationConfigurationError,
} from "../src/integration/gate";
import {
  loadAccountData,
  readOnlyApi,
  setSummary,
  loadSetData,
} from "../src/integration/data";
import { startAccountRead, startSetRead } from "../src/integration/read-session";
import { SetDetailPage } from "../src/app/SetDetailPage";
import { SkillsPage } from "../src/app/SkillsPage";
import { SetsPage } from "../src/app/SetsPage";
import { AgentsPage, HomePage } from "../src/app/AccountPages";
import { groupSyncedSkills } from "../src/synced-skill-grouping";
import { makeFixtures } from "../src/preview/fixtures";
import type { PortalApi } from "../src/portal-api";
import type { PortalActions } from "../src/app/model";
import type { SkillGroup } from "../src/groups/types";

const identity = { name: "Test account", email: "test@example.com" };
const group: SkillGroup = {
  id: "set-1",
  name: "Real set",
  description: null,
  slug: "real-set",
  itemCount: 42,
  visibility: "restricted",
  disabledAt: "2026-09-24T00:00:00Z",
  allowedEmails: [{ id: "email-1", email: "member@example.com" }],
  syncedSkillIds: ["physical-id"],
};
function responses(path: string) {
  if (path.endsWith("synced-skills")) return { skills: makeFixtures().skills };
  if (path.endsWith("groups")) return { groups: [group] };
  if (path.endsWith("shared"))
    return {
      groups: [{ ...group, id: "shared-1", ownerDisplayName: "Other owner" }],
    };
  if (path.endsWith("profile"))
    return {
      profile: { handle: null, profilePublished: false, publicUrl: null },
    };
  throw new Error(`Unexpected path ${path}`);
}
const api: PortalApi = async <T>(path: string) => responses(path) as T;
const noOp = () => {};
const actions: PortalActions = {
  updateSet: noOp,
  createSet: noOp,
  deleteSet: noOp,
  membership: noOp,
  revoke: noOp,
  updateProfile: noOp,
  retry: noOp,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("local mutation allowlist permits profile, sets, items and email access only", () => {
  assert.equal(isIntegrationRequest("/api/portal/profile", "PATCH"), true);
  assert.equal(isIntegrationRead("/api/portal/profile", "PATCH"), false);
  assert.equal(isIntegrationRequest("/api/portal/groups", "POST"), true);
  assert.equal(isIntegrationRequest("/api/portal/groups/a", "PATCH"), true);
  assert.equal(isIntegrationRequest("/api/portal/groups/a", "DELETE"), true);
  assert.equal(isIntegrationRequest("/api/portal/groups/a/moderation", "PATCH"), true);
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(isIntegrationRequest("/api/portal/groups/a/items", method), true);
  for (const method of ["POST", "DELETE"]) assert.equal(isIntegrationRequest("/api/portal/groups/a/allowed-emails", method), true);
  assert.equal(isIntegrationRequest("/api/portal/groups/a/allowed-emails", "PATCH"), false);
  for (const path of ["/api/portal/devices", "/api/portal/profile?x=1", "/api/portal/sync-upload"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(isIntegrationRequest(path, method), false);
  }
  assert.equal(isIntegrationRequest("/api/portal/profile", "DELETE"), false);
  assert.equal(isIntegrationRequest("/api/portal/profile", "POST"), false);
});

test("local body guard allows synced membership and narrow email bodies without arbitrary publication", () => {
  const path = "/api/portal/groups";
  const body = { name: "Test", visibility: "private", syncedSkillIds: [] };
  assert.equal(isIntegrationBody(path, "POST", body), true);
  assert.equal(isIntegrationBody(path, "POST", { ...body, syncedSkillIds: ["id"] }), true);
  assert.equal(isIntegrationBody(path, "POST", { name: "Favorite Skills", isFavorites: true, visibility: "public", syncedSkillIds: ["id"] }), true);
  for (const changes of [{ visibility: "public" }, { isFavorites: true }, { syncedSkillIds: ["id", "id"] }, { items: [] }]) {
    assert.equal(isIntegrationBody(path, "POST", { ...body, ...changes }), false);
  }
  assert.equal(isIntegrationBody(`${path}/a`, "PATCH", { name: "New", description: "Text", visibility: "restricted" }), true);
  assert.equal(isIntegrationBody(`${path}/a`, "PATCH", { emails: [] }), false);
  assert.equal(isIntegrationBody(`${path}/a/moderation`, "PATCH", { disabled: true }), true);
  assert.equal(isIntegrationBody(`${path}/a/moderation`, "PATCH", { disabled: "true" }), false);
  assert.equal(isIntegrationBody(`${path}/a`, "DELETE", undefined), true);
  assert.equal(isIntegrationBody(`${path}/a/items`, "POST", { kind: "synced", syncedSkillId: "id" }), true);
  assert.equal(isIntegrationBody(`${path}/a/items`, "POST", { kind: "catalog", catalogSkillId: "owner/repo" }), false);
  assert.equal(isIntegrationBody(`${path}/a/items`, "POST", { kind: "github", githubUrl: "https://github.com/owner/repo" }), false);
  assert.equal(isIntegrationBody(`${path}/a/items`, "DELETE", { itemId: "id" }), true);
  assert.equal(isIntegrationBody(`${path}/a/items`, "PATCH", { itemIds: ["a", "b"] }), true);
  assert.equal(isIntegrationBody(`${path}/a/items`, "PATCH", { itemIds: ["a", "a"] }), false);
  assert.equal(isIntegrationBody(`${path}/a/allowed-emails`, "POST", { email: "reader@example.test" }), true);
  assert.equal(isIntegrationBody(`${path}/a/allowed-emails`, "DELETE", { emailId: "record-id" }), true);
  assert.equal(isIntegrationBody(`${path}/a/allowed-emails`, "DELETE", { email: "reader@example.test" }), false);
  assert.equal(isIntegrationBody(`${path}/a/allowed-emails`, "POST", { email: "reader@example.test", role: "owner" }), false);
});

test("integration requires development, loopback, a dedicated path, and explicit opt-in", () => {
  const valid = {
    development: true,
    enabled: "1",
    hostname: "127.0.0.1",
    pathname: "/app/integration/",
  };
  assert.equal(isLocalIntegration(valid), true);
  for (const change of [
    { development: false },
    { enabled: undefined },
    { enabled: "true" },
    { hostname: "omgskills.com" },
    { pathname: "/app/connect" },
    { pathname: "/app/preview/" },
    { pathname: "/app/integration-other" },
  ]) {
    assert.equal(isLocalIntegration({ ...valid, ...change }), false);
  }
  const config = {
    ready: true,
    publishableKey: "pk_test_fixture",
    webEnabled: "1",
  };
  assert.equal(integrationConfigurationError(config), null);
  for (const change of [
    { ready: false },
    { publishableKey: "pk_live_fixture" },
    { publishableKey: undefined },
    { webEnabled: "0" },
  ]) {
    assert.ok(integrationConfigurationError({ ...config, ...change }));
  }
});

test("backend requires explicit verification and a loopback origin, never a production fallback", () => {
  const env = {
    PORTAL_TEST_ENVIRONMENT_VERIFIED: "1",
    PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888",
  };
  assert.equal(testBackendOrigin(env), "http://127.0.0.1:8888");
  assert.equal(
    testBackendOrigin({ ...env, PORTAL_TEST_ENVIRONMENT_VERIFIED: undefined }),
    null,
  );
  for (const origin of [
    "https://omgskills.com",
    "http://localhost.evil.test:8888",
    "http://127.0.0.1:8888/api",
    "http://user:pass@localhost:8888",
    "http://localhost",
    "http://localhost:8888?x=1",
    "",
  ]) {
    assert.equal(
      testBackendOrigin({ ...env, PORTAL_TEST_API_ORIGIN: origin }),
      null,
    );
  }
});

test("read-only transport rejects writes, auth endpoints, redirects, and other destinations", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return {} as T;
  };
  const read = readOnlyApi(transport);
  for (const method of ["POST", "PATCH", "DELETE"])
    await assert.rejects(read("/api/portal/profile", { method }));
  for (const path of [
    "https://omgskills.com/api/portal/profile",
    "/api/portal/sync-pairing-code",
    "/api/portal/devices/not-a-device",
    "/api/portal/groups/a/items",
    "/api/portal/groups/../profile",
    "/api/portal/profile?x=1",
  ]) {
    assert.equal(isIntegrationRead(path), false);
    await assert.rejects(read(path));
  }
  await assert.rejects(read("/api/portal/profile", { body: "{}" }));
  assert.equal(calls.length, 0);
  await read("/api/portal/groups/group-1");
  assert.equal(calls[0].init?.redirect, "error");
  assert.equal(calls[0].init?.cache, "no-store");
});

test("account reads use four existing endpoints and preserve real summary counts and permissions", async () => {
  const paths: string[] = [];
  const recording: PortalApi = async <T>(path: string) => {
    paths.push(path);
    return responses(path) as T;
  };
  const result = await loadAccountData(readOnlyApi(recording), identity);
  assert.deepEqual(paths, [
    "/api/portal/synced-skills",
    "/api/portal/groups",
    "/api/portal/shared",
    "/api/portal/profile",
  ]);
  assert.equal(result.sets[0].itemCount, 42);
  assert.equal(result.sets[0].items.length, 0);
  assert.equal(result.sets[0].hidden, true);
  assert.equal(result.sets[0].role, "owner");
  assert.deepEqual(result.sets[0].membershipSkillIds, ["physical-id"]);
  assert.deepEqual(result.sets[0].allowedEmails, group.allowedEmails);
  assert.equal(result.sets[1].role, "invited");
  assert.deepEqual(result.sets[1].emails, []);
  assert.equal(result.sets[1].allowedEmails, undefined);
  assert.equal(result.sets[1].membershipSkillIds, undefined);
  assert.equal(result.profile.handle, "");
  assert.equal(result.profile.publicUrl, null);
  assert.deepEqual(result.devices, []);
  assert.equal(result.privateSourceConnected, null);
});

test("cancelled reads cannot deliver a previous account even if the transport ignores abort", async () => {
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const delayed: PortalApi = <T>(path: string, init?: RequestInit) =>
    new Promise<T>((resolve) => {
      signals.push(init!.signal!);
      releases.push(() => resolve(responses(path) as T));
    });
  const delivered: string[] = [];
  const cancel = startAccountRead(
    delayed,
    identity,
    (data) => delivered.push(data.profile.name),
    () => delivered.push("error"),
  );
  cancel();
  assert.ok(signals.every((signal) => signal.aborted));
  const cancelNext = startAccountRead(
    api,
    { ...identity, name: "Next account" },
    (data) => delivered.push(data.profile.name),
    () => delivered.push("error"),
  );
  releases.forEach((release) => release());
  await tick();
  assert.deepEqual(delivered, ["Next account"]);
  cancelNext();
});

test("failed and malformed account reads never deliver a partial dashboard", async () => {
  for (const bad of [null, { profile: {} }]) {
    const broken: PortalApi = async <T>(path: string) =>
      (path.endsWith("profile") ? bad : responses(path)) as T;
    await assert.rejects(loadAccountData(broken, identity));
  }
  const delivered: string[] = [];
  const broken: PortalApi = async () => {
    throw new Error("Unauthorized");
  };
  const cancel = startAccountRead(
    broken,
    identity,
    () => delivered.push("success"),
    () => delivered.push("error"),
  );
  await tick();
  assert.deepEqual(delivered, ["error"]);
  cancel();
});

test("read-only skills disable changes and sets render counts without fabricated items", async () => {
  const data = await loadAccountData(api, identity);
  const skills = renderToStaticMarkup(
    createElement(SkillsPage, {
      skills: groupSyncedSkills(data.skills),
      sets: data.sets,
      actions,
      source: "all",
      setSource: noOp,
      edit: false,
      newSet: noOp,
      star: noOp,
      inspect: noOp,
      readOnly: true,
    }),
  );
  for (const button of skills.matchAll(/<button\b[^>]*>/g)) {
    if (/aria-label="(?:Star|Unstar|Add .* to set)/.test(button[0]))
      assert.match(button[0], /disabled/);
  }
  assert.ok(skills.includes("Favorites changes are not connected yet"));
  const sets = renderToStaticMarkup(
    createElement(SetsPage, {
      sets: [setSummary(group, true, identity.name)],
      edit: false,
      remove: noOp,
      link: (path, children) => createElement("a", { href: path }, children),
    }),
  );
  assert.match(sets, /42 skills/);
  assert.doesNotMatch(sets, /Delete Real set/);
});

test("unloaded devices and private sources are not presented as disconnected or fake data", async () => {
  const data = await loadAccountData(api, identity);
  const agents = renderToStaticMarkup(
    createElement(AgentsPage, {
      data,
      skills: groupSyncedSkills(data.skills),
      readOnly: true,
      revoke: noOp,
      unavailable: noOp,
      link: (path, children) => createElement("a", { href: path }, children),
    }),
  );
  assert.match(agents, /Device information is not loaded/);
  assert.doesNotMatch(agents, /No connected devices/);
  const home = renderToStaticMarkup(
    createElement(HomePage, {
      data,
      actions,
      readOnly: true,
      editProfile: noOp,
      unavailable: noOp,
      copy: noOp,
    }),
  );
  assert.match(home, /No handle set/);
  assert.match(home, /Private-source information is not loaded/);
  assert.doesNotMatch(home, /No installation connected|example-studio/);
  assert.match(home, /disabled=""[^>]*aria-label="Publish profile"/);
});

const detailResponse = (accessRole = "owner") => ({
  group: { ...group, ownerDisplayName: "Actual owner" },
  accessRole,
  items: [
    { id: "b", kind: "catalog", name: "Second", description: "Full description", githubUrl: "https://github.com/example/skills", source: "catalog", position: 2 },
    { id: "a", kind: "synced", name: "First", description: "", githubUrl: null, source: "Claude", position: 1 },
  ],
});

test("set details preserve server roles, owner, order and metadata without inventing identity", async () => {
  for (const role of ["owner", "invited", "public"]) {
    const transport: PortalApi = async <T>() => detailResponse(role) as T;
    const set = await loadSetData(readOnlyApi(transport), group.id);
    assert.equal(set.role, role);
    assert.equal(set.ownerName, "Actual owner");
    assert.equal(set.visibility, "restricted");
    assert.deepEqual(set.items.map((item) => item.id), ["a", "b"]);
    assert.ok(set.items.every((item) => item.syncedSkillId === null));
    assert.equal(set.items[1].kind, "catalog");
    assert.equal(set.items[1].description, "Full description");
    assert.equal(set.emails.length, role === "owner" ? 1 : 0);
  }
});

test("invalid or inaccessible set responses fail closed", async () => {
  const valid = detailResponse();
  for (const response of [
    { ...valid, accessRole: "admin" },
    { ...valid, group: { ...valid.group, id: "other" } },
    { ...valid, items: null },
    { ...valid, items: [valid.items[0], valid.items[0]] },
    { ...valid, items: [{ ...valid.items[0], kind: "unknown" }] },
    { ...valid, items: [{ ...valid.items[1], syncedSkillId: 123 }] },
    { ...valid, items: [{ ...valid.items[1], syncedSkillId: "" }] },
    { ...valid, group: { ...valid.group, allowedEmails: [{ email: "missing-id@example.test" }] } },
    { ...valid, group: { ...valid.group, allowedEmails: [group.allowedEmails![0], group.allowedEmails![0]] } },
  ]) {
    const transport: PortalApi = async <T>() => response as T;
    await assert.rejects(loadSetData(transport, group.id));
  }
  const delivered: string[] = [];
  const cancel = startSetRead(async () => { throw new Error("Forbidden"); }, group.id,
    () => delivered.push("success"), () => delivered.push("error"));
  await tick();
  assert.deepEqual(delivered, ["error"]);
  cancel();
});

test("owner detail retains physical and email IDs; shared adapters discard owner-only mappings", async () => {
  for (const role of ["owner", "invited", "public"]) {
    const response = detailResponse(role);
    const transport: PortalApi = async <T>() => ({ ...response,
      items: response.items.map((item) => ({ ...item, syncedSkillId: "physical-id" })),
    }) as T;
    const set = await loadSetData(transport, group.id);
    assert.equal(set.items[0].syncedSkillId, role === "owner" ? "physical-id" : null);
    assert.equal(set.items[1].syncedSkillId, null, "catalog entries are not installation mappings");
    assert.deepEqual(set.allowedEmails, role === "owner" ? group.allowedEmails : undefined);
  }
});

test("old and null physical IDs remain unknown rather than inferred", async () => {
  for (const syncedSkillId of [undefined, null]) {
    const response = detailResponse();
    const transport: PortalApi = async <T>() => ({ ...response,
      items: response.items.map((item) => ({ ...item, syncedSkillId })),
    }) as T;
    assert.ok((await loadSetData(transport, group.id)).items.every((item) => item.syncedSkillId === null));
  }
  const { allowedEmails: _, ...legacy } = group;
  assert.equal(setSummary(legacy, true, identity.name).allowedEmails, undefined);
});

test("cancelled set reads never deliver stale detail even if transport ignores abort", async () => {
  let release = () => {};
  let signal: AbortSignal | null | undefined;
  const transport: PortalApi = <T>(_path: string, init?: RequestInit) => new Promise<T>((resolve) => {
    signal = init?.signal;
    release = () => resolve(detailResponse() as T);
  });
  const delivered: string[] = [];
  const cancel = startSetRead(transport, group.id,
    () => delivered.push("success"), () => delivered.push("error"));
  cancel();
  assert.equal(signal?.aborted, true);
  release();
  await tick();
  assert.deepEqual(delivered, []);
});

test("new set detail is read-only even for owners with edit requested", async () => {
  const transport: PortalApi = async <T>() => detailResponse() as T;
  const set = await loadSetData(transport, group.id);
  const html = renderToStaticMarkup(createElement(SetDetailPage, {
    set, sets: [], skills: [], actions, edit: true, readOnly: true,
    addSkills: noOp, notify: noOp, star: noOp, newSet: noOp,
  }));
  assert.match(html, /rd-detail-table/);
  assert.match(html, /Full description/);
  assert.match(html, /Invite only/);
  assert.match(html, /Favorites changes are not connected yet/);
  assert.doesNotMatch(html, /Not in your synced library/);
  assert.doesNotMatch(html, /Add email|Add skills|Move .* up|Move .* down|Choose Edit/);
  for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /disabled/);
  const empty = renderToStaticMarkup(createElement(SetDetailPage, {
    set: { ...set, items: [] }, sets: [], skills: [], actions, edit: false, readOnly: true,
    addSkills: noOp, notify: noOp, star: noOp, newSet: noOp,
  }));
  assert.match(empty, /No skills in this set/);
  assert.doesNotMatch(empty, /Choose Edit/);
});
