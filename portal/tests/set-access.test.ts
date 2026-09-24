import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { saveSetData } from "../src/integration/set-data";
import { SetAccessControls } from "../src/integration/SetAccessControls";
import { createAccountSession } from "../src/integration/account-session";
import { setSummary } from "../src/integration/data";
import { setLink, copySetLink } from "../src/app/set-link";
import type { PortalApi } from "../src/portal-api";
import { PortalApiError } from "../src/api-error";
import type { PortalData, PortalSet } from "../src/app/model";

const group = { id: "set", name: "Test", slug: "test", description: null, visibility: "restricted" as const,
  isFavorites: false, disabledAt: null as string | null, itemCount: 0, allowedEmails: [{ id: "email-1", email: "reader@example.test" }] };
const signal = () => new AbortController().signal;
function fixture(overrides: Record<string, unknown> = {}) {
  const value = { ...group, ...overrides };
  const calls: { path: string; method: string; body: any }[] = [];
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ path, method, body });
    if (method === "POST") return { email: body.email } as T;
    if (method === "DELETE") return { emailId: body.emailId } as T;
    return { group: value, accessRole: overrides.role ?? "owner", items: [] } as T;
  };
  return { api, calls };
}

test("email add normalizes and sends only email through the existing endpoint", async () => {
  const f = fixture();
  await saveSetData(f.api, { kind: "add-email", id: "set", email: " NEW@Example.Test " }, signal());
  assert.deepEqual(f.calls[1], { path: "/api/portal/groups/set/allowed-emails", method: "POST", body: { email: "new@example.test" } });
});

test("duplicate and invalid emails retain drafts by rejecting before writes", async () => {
  for (const email of ["READER@example.test", "", "broken", "a@b", "a @b.test"]) {
    const f = fixture();
    await assert.rejects(saveSetData(f.api, { kind: "add-email", id: "set", email }, signal()));
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("email access fails closed for shared, hidden, public, private, Favorites or missing records", async () => {
  for (const changes of [{ role: "invited" }, { role: "public" }, { disabledAt: "now" }, { visibility: "public" },
    { visibility: "private" }, { isFavorites: true }, { allowedEmails: undefined }]) {
    const f = fixture(changes);
    await assert.rejects(saveSetData(f.api, { kind: "add-email", id: "set", email: "new@example.test" }, signal()));
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("email removal uses record identity, preserves others, and tolerates already absent records", async () => {
  const f = fixture({ allowedEmails: [...group.allowedEmails, { id: "email-2", email: "other@example.test" }] });
  const result = await saveSetData(f.api, { kind: "remove-email", id: "set", emailId: "email-1" }, signal());
  assert.deepEqual(f.calls[1].body, { emailId: "email-1" });
  assert.deepEqual(result.fields, { allowedEmails: [{ id: "email-2", email: "other@example.test" }], emails: ["other@example.test"] });
  const absent = fixture();
  await saveSetData(absent.api, { kind: "remove-email", id: "set", emailId: "absent" }, signal());
  assert.equal(absent.calls.length, 1);
});

test("saved email removal is allowed outside Invite-only without changing visibility", async () => {
  for (const visibility of ["public", "private"]) {
    const f = fixture({ visibility });
    await saveSetData(f.api, { kind: "remove-email", id: "set", emailId: "email-1" }, signal());
    assert.equal(f.calls[1].method, "DELETE");
  }
});

test("malformed mutation responses are not treated as confirmed email changes", async () => {
  const f = fixture();
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => init?.method === "POST" ? {} as T : f.api(path, init);
  await assert.rejects(saveSetData(api, { kind: "add-email", id: "set", email: "new@example.test" }, signal()), /Unexpected access response/);
});

function sessionFixture(write: PortalApi) {
  let readsFail = false;
  let events = 0;
  const f = fixture();
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") return write<T>(path, init);
    if (readsFail) throw new Error("Offline");
    if (path.endsWith("/groups")) return { groups: [group] } as T;
    if (path.endsWith("/shared")) return { groups: [] } as T;
    if (path.endsWith("/synced-skills")) return { skills: [] } as T;
    if (path.endsWith("/profile")) return { profile: { handle: null, profilePublished: false, publicUrl: null } } as T;
    return f.api<T>(path, init);
  };
  const session = createAccountSession({ api, identity: { name: "Test", email: "owner@example.test" }, cacheKey: "c4", changed: () => { events++; } });
  return { session, failReads: () => { readsFail = true; }, events: () => events };
}

test("email writes serialize against all set writes and account disposal suppresses late results", async () => {
  let release = () => {};
  const f = sessionFixture(async <T>() => { await new Promise<void>((resolve) => { release = resolve; }); return { email: "new@example.test" } as T; });
  await f.session.refresh();
  const save = f.session.saveSet({ kind: "add-email", id: "set", email: "new@example.test" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(f.session.saveSet({ kind: "delete", id: "set" }), /already in progress/);
  f.session.dispose(); const events = f.events();
  const rejected = assert.rejects(save, { name: "AbortError" }); release(); await rejected;
  assert.equal(f.events(), events);
});

test("confirmed email save survives read failure and cannot be blindly resubmitted", async () => {
  let writes = 0;
  const f = sessionFixture(async <T>() => { writes++; f.failReads(); return { email: "new@example.test" } as T; });
  await f.session.refresh();
  const command = { kind: "add-email" as const, id: "set", email: "new@example.test" };
  assert.equal((await f.session.saveSet(command)).refreshed, false);
  assert.match(f.session.getSnapshot().error, /Saved, but/);
  await assert.rejects(f.session.saveSet(command), /Refresh/);
  assert.equal(writes, 1); f.session.dispose();
});

test("unknown email outcomes require refresh; authorization failures clear data", async () => {
  for (const error of [new Error("Network lost"), new PortalApiError("Denied", 403)]) {
    const f = sessionFixture(async () => { throw error; });
    await f.session.refresh();
    await assert.rejects(f.session.saveSet({ kind: "add-email", id: "set", email: "new@example.test" }));
    assert.ok(f.session.getSnapshot().error);
    if (error instanceof PortalApiError) assert.equal(f.session.getSnapshot().data, null);
    f.session.dispose();
  }
});

const set: PortalSet = { ...setSummary(group, true, "Owner"), visibility: "public" };
const profile: PortalData["profile"] = { name: "Owner", email: "owner@example.test", handle: "Owner", published: true };
test("only eligible owned public sets get a canonical URL", () => {
  assert.equal(setLink(set, profile, "https://app.omgskills.com", "/app/", false).url, "https://omgskills.com/u/owner/sets/test");
  for (const changes of [{ visibility: "restricted" as const }, { visibility: "private" as const }, { hidden: true },
    { role: "invited" as const }, { slug: undefined }, { slug: "../escape" }]) {
    assert.equal(setLink({ ...set, ...changes }, profile, "https://omgskills.com", "/app/", false).url, "https://omgskills.com/app/groups/set");
  }
  for (const changes of [{ published: false }, { handle: "" }, { handle: "../escape" }]) {
    assert.equal(setLink(set, { ...profile, ...changes }, "https://omgskills.com", "/app/", false).url, "https://omgskills.com/app/groups/set");
  }
});

test("local links cannot leak into production and clipboard failures never announce success", async () => {
  const link = setLink(set, profile, "http://127.0.0.1:5174", "/app/integration/", true);
  assert.equal(link.url, "http://127.0.0.1:5174/app/integration/groups/set");
  let copied = "";
  assert.equal(await copySetLink(link, async (text) => { copied = text; }), "Local set link copied.");
  assert.equal(copied, link.url);
  await assert.rejects(copySetLink(link, async () => { throw new Error("Denied"); }), /Could not copy/);
});

test("shared access UI never displays emails or management controls", () => {
  const html = renderToStaticMarkup(createElement(SetAccessControls, { set: { ...set, role: "invited" }, busy: false, blocked: false, save: async () => ({ refreshed: true }) }));
  assert.match(html, /read-only access/); assert.doesNotMatch(html, /reader@example|Add email|Remove access|Remove saved/);
});

test("owner UI distinguishes saved emails from active access and protects Favorites", () => {
  const render = (value: PortalSet) => renderToStaticMarkup(createElement(SetAccessControls, { set: value, busy: false, blocked: false, save: async () => ({ refreshed: true }) }));
  assert.match(render(set), /Saved emails do not limit/);
  assert.doesNotMatch(render(set), /Add email/);
  assert.match(render({ ...set, visibility: "restricted" }), /No invitation email is sent/);
  assert.doesNotMatch(render({ ...set, visibility: "restricted", isFavorites: true }), /Add email|Remove access/);
});
