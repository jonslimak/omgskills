import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateSourceSession, parsePrivateSources, validSkillRoot } from "../src/integration/private-source-session";
import type { PortalApi } from "../src/portal-api";
import { PortalApiError } from "../src/api-error";
import { isIntegrationBody, isIntegrationRequest } from "../integration-config";
import { PrivateSourceFixtureBroker, fixtureInstallation, fixtureRepository } from "../testing/private-source-broker";

const source = { id: "d3000000-0000-4000-8000-000000000001", installationId: fixtureInstallation.installationId,
  repositoryId: fixtureRepository.id, repositorySlug: fixtureRepository.fullName, normalizedRoot: ".", createdAt: "2026-01-01T00:00:00Z" };
const view = { installations: [{ ...fixtureInstallation, repositories: [fixtureRepository] }], sources: [source] };
const input = { installationId: source.installationId, repositoryId: source.repositoryId, root: "." };
const release = { id: "d3000000-0000-4000-8000-000000000002", sourceId: source.id,
  commitSha: "a".repeat(40), treeSha: "b".repeat(40), skillMdSha: "c".repeat(40), createdAt: source.createdAt };
const make = (api: PortalApi) => createPrivateSourceSession(api, () => {}, () => {});

test("source validation preserves dot directories and rejects malformed or overlapping responses", () => {
  for (const root of [".", " . ", "skills/foo", ".claude/skills/Design"]) assert.equal(validSkillRoot(root), true);
  for (const root of ["", "..", "/root", "root/", "a//b", "a/../b", "a/./b", "a\\b", "a\nb"]) assert.equal(validSkillRoot(root), false);
  assert.deepEqual(parsePrivateSources(view), view);
  for (const value of [null, {}, { ...view, sources: [source, source] }, { ...view, sources: [{ ...source, normalizedRoot: "../foo" }] },
    { ...view, installations: [view.installations[0], view.installations[0]] },
    { ...view, installations: [{ ...fixtureInstallation, repositories: [{ ...fixtureRepository, isPrivate: false }] }] }]) {
    assert.throws(() => parsePrivateSources(value as typeof view));
  }
});
test("local source route guard permits only explicit fields and bodyless snapshot POST", () => {
  const route = `/api/portal/private-sources/${source.id}/releases`;
  assert.equal(isIntegrationRequest("/api/portal/private-sources"), true);
  assert.equal(isIntegrationBody("/api/portal/private-sources", "POST", input), true);
  for (const body of [{ ...input, ownerUserId: "injected" }, { ...input, repositoryId: "0" }, { ...input, root: 4 }, {}]) {
    assert.equal(isIntegrationBody("/api/portal/private-sources", "POST", body), false);
  }
  assert.equal(isIntegrationBody(route, "POST", undefined), true);
  assert.equal(isIntegrationBody(route, "POST", {}), false);
  for (const [path, method] of [[route, "GET"], [route, "DELETE"], ["/api/portal/private-sources/bad/releases", "POST"],
    [`/api/portal/private-releases/${release.id}/package`, "GET"], ["/api/portal/device-exchange", "POST"]]) assert.equal(isIntegrationRequest(path, method), false);
});
test("empty view is disconnected; failed reads are errors, not disconnected state", async () => {
  const empty = make(async <T>() => ({ installations: [], sources: [] }) as T);
  await empty.refresh(); assert.deepEqual(empty.getSnapshot().view, { installations: [], sources: [] }); empty.dispose();
  const failed = make(async () => { throw new Error("Missing Broker configuration"); });
  await failed.refresh(); assert.equal(failed.getSnapshot().view, null); assert.match(failed.getSnapshot().error, /Could not load/); failed.dispose();
});
test("confirmed register with failed refresh retains confirmed row without replaying write", async () => {
  let writes = 0;
  const session = make(async <T>(_path: string, init?: RequestInit) => {
    if (init?.method === "POST") { writes++; return { source } as T; }
    if (writes) throw new Error("Offline");
    return { ...view, sources: [] } as T;
  });
  await session.refresh(); await session.register(input);
  assert.equal(session.getSnapshot().view?.sources[0].id, source.id);
  assert.match(session.getSnapshot().error, /registered, but/);
  await assert.rejects(session.register(input)); assert.equal(writes, 1); session.dispose();
});
test("unknown or mismatched writes require refresh and cannot claim success", async () => {
  for (const result of [null, { source: { ...source, repositoryId: "999" } }]) {
    let writes = 0;
    const session = make(async <T>(_path: string, init?: RequestInit) => {
      if (init?.method === "POST") { writes++; if (!result) throw new Error("Lost response"); return result as T; }
      return view as T;
    });
    await session.refresh(); await session.register(input);
    assert.match(session.getSnapshot().error, /Could not confirm/); assert.equal(session.getSnapshot().notice, "");
    await assert.rejects(session.register(input)); assert.equal(writes, 1);
    await session.refresh(); assert.equal(session.getSnapshot().error, ""); session.dispose();
  }
});
test("registration uses exact permitted IDs and preserves normalized path case", async () => {
  let payload: unknown;
  const session = make(async <T>(_path: string, init?: RequestInit) => {
    if (init?.method === "POST") { payload = JSON.parse(String(init.body)); return { source: { ...source, normalizedRoot: ".claude/skills/Design" } } as T; }
    return view as T;
  });
  await session.refresh();
  await assert.rejects(session.register({ ...input, repositoryId: "999" }));
  await assert.rejects(session.register({ ...input, root: "../foo" }));
  await session.register({ ...input, root: " .claude/skills/Design " });
  assert.deepEqual(payload, { ...input, root: ".claude/skills/Design" }); session.dispose();
});
test("snapshot is bodyless, validates source and supports idempotent returned release", async () => {
  let writes = 0;
  const session = make(async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++; assert.equal(path, `/api/portal/private-sources/${source.id}/releases`); assert.equal(init.body, undefined);
      return { release } as T;
    }
    return view as T;
  });
  await session.refresh(); await assert.rejects(session.release("not-owned"));
  await session.release(source.id); await session.release(source.id);
  assert.equal(writes, 2); assert.deepEqual(session.getSnapshot().releases, { [source.id]: release }); session.dispose();
});
test("mismatched snapshot is not shown", async () => {
  const session = make(async <T>(_path: string, init?: RequestInit) => init?.method === "POST"
    ? { release: { ...release, sourceId: "different" } } as T : view as T);
  await session.refresh(); await session.release(source.id);
  assert.deepEqual(session.getSnapshot().releases, {}); assert.match(session.getSnapshot().error, /Could not confirm/); session.dispose();
});
test("reads coalesce; writes serialize; unmount aborts and ignores late responses", async () => {
  for (const mode of ["read", "register", "release"]) {
    let finish!: (result: unknown) => void;
    let signal: AbortSignal | null | undefined;
    let events = 0;
    let wait = mode === "read";
    const api: PortalApi = <T>(_path: string, init?: RequestInit) => {
      if (!wait) return Promise.resolve(view as T);
      signal = init?.signal;
      return new Promise((resolve) => { finish = resolve as typeof finish; }) as Promise<T>;
    };
    const session = createPrivateSourceSession(api, () => events++, () => {});
    if (mode !== "read") await session.refresh();
    wait = true;
    const pending = mode === "read" ? session.refresh() : mode === "register" ? session.register(input) : session.release(source.id);
    assert.equal(session.refresh(), pending); await assert.rejects(session.register(input));
    session.dispose(); const before = events; assert.equal(signal?.aborted, true);
    finish(mode === "read" ? view : mode === "register" ? { source } : { release }); await pending;
    assert.equal(events, before);
  }
});
test("401 and 403 clear private state and invalidate account; 502 and 503 do not", async () => {
  for (const status of [401, 403, 502, 503]) for (const mode of ["read", "register", "release"]) {
    let denied = 0;
    const session = createPrivateSourceSession(async <T>(_path: string, init?: RequestInit) => {
      if (mode === "read" || init?.method === "POST") throw new PortalApiError("Unavailable", status);
      return view as T;
    }, () => {}, () => denied++);
    await session.refresh();
    if (mode === "register") await session.register(input);
    if (mode === "release") await session.release(source.id);
    assert.equal(denied, status < 500 ? 1 : 0);
    if (status < 500) assert.equal(session.getSnapshot().view, null);
    assert.deepEqual(session.getSnapshot().releases, {}); session.dispose();
  }
});
test("local broker handles permitted roots, missing files, empty, revoked and rate limited grants without GitHub", async () => {
  const broker = new PrivateSourceFixtureBroker();
  const first = await broker.fetchCurrentSkillPackage(fixtureInstallation.installationId, fixtureRepository, ".");
  assert.deepEqual(await broker.fetchCurrentSkillPackage(fixtureInstallation.installationId, fixtureRepository, "."), first);
  await broker.verifySkillRoot(fixtureInstallation.installationId, fixtureRepository, ".claude/skills/Design");
  await assert.rejects(broker.verifySkillRoot(fixtureInstallation.installationId, fixtureRepository, "missing"));
  await assert.rejects(broker.listRepositories("different"));
  await assert.rejects(broker.verifySkillRoot(fixtureInstallation.installationId, { ...fixtureRepository, id: "999" }, "."));
  assert.deepEqual(await new PrivateSourceFixtureBroker("empty").listRepositories(fixtureInstallation.installationId), []);
  for (const scenario of ["revoked", "rate-limited"] as const) await assert.rejects(new PrivateSourceFixtureBroker(scenario).listRepositories(fixtureInstallation.installationId));
});
