import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Context } from "@netlify/functions";
import { GitHubBrokerError } from "./github-broker.js";
import { PrivateReleaseAccessError, type PrivateReleaseGrant } from "./private-release-access.js";
import { gitObjectSha, type SkillPackage } from "./skill-package.js";
import {
  config,
  portalPrivateReleases,
  type PortalPrivateReleasesDependencies
} from "../portal-private-releases.mjs";

const context = { deploy: { context: "production" }, params: {} } as Context;
const actor = { id: "owner-id", clerkUserId: "clerk-id", email: "owner@example.com", displayName: "Owner" };
const sourceId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";

function fixturePackage(): SkillPackage {
  const data = Buffer.from("# Example\n");
  const skillMdSha = gitObjectSha("blob", data);
  const treeContent = Buffer.concat([
    Buffer.from("100644 SKILL.md\0"),
    Buffer.from(skillMdSha, "hex")
  ]);
  const treeSha = createHash("sha1")
    .update(Buffer.from(`tree ${treeContent.byteLength}\0`))
    .update(treeContent)
    .digest("hex");
  return {
    coordinates: { commitSha: "a".repeat(40), treeSha, skillMdSha },
    entries: [{ path: "SKILL.md", mode: "100644", blobSha: skillMdSha, data }]
  };
}

const release = {
  id: releaseId,
  sourceId,
  ...fixturePackage().coordinates,
  createdAt: "2026-08-27T20:00:00Z"
};
const grant: PrivateReleaseGrant = {
  accessRole: "owner",
  actorUserId: actor.id,
  deviceId: null,
  ownerUserId: actor.id,
  installationId: "456",
  repositoryId: "321",
  repositorySlug: "owner/private-skills",
  normalizedRoot: "skills/example",
  groupId: null,
  skillItemId: null,
  releaseId,
  sourceId,
  commitSha: release.commitSha,
  treeSha: release.treeSha,
  skillMdSha: release.skillMdSha,
  createdAt: release.createdAt
};

function dependencies(
  overrides: Partial<PortalPrivateReleasesDependencies> = {}
): PortalPrivateReleasesDependencies {
  return {
    async requirePortalUser() { return actor; },
    async register() { return release; },
    async authorize() { return grant; },
    async loadPackage() { return fixturePackage(); },
    async recordContentFetch() {},
    ...overrides
  };
}

test("owner registers a release by source ID without supplying Git coordinates", async () => {
  let received: unknown;
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-sources/${sourceId}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "attacker/repo", path: "secret", commitSha: "bad" })
    }),
    context,
    dependencies({
      async register(ownerUserId, receivedSourceId) {
        received = { ownerUserId, sourceId: receivedSourceId };
        return release;
      }
    })
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(received, { ownerUserId: "owner-id", sourceId });
});

test("owner package route accepts only an opaque release ID and streams validated NDJSON", async () => {
  const received: unknown[] = [];
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async authorize(receivedActor, receivedReleaseId) {
        received.push({ action: "authorize", actorId: receivedActor.id, releaseId: receivedReleaseId });
        return grant;
      },
      async loadPackage(receivedGrant) {
        received.push({ action: "load", releaseId: receivedGrant.releaseId });
        return fixturePackage();
      },
      async recordContentFetch(receivedGrant) {
        received.push({ action: "audit", releaseId: receivedGrant.releaseId });
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.deepEqual(received, [
    { action: "authorize", actorId: "owner-id", releaseId },
    { action: "load", releaseId },
    { action: "authorize", actorId: "owner-id", releaseId },
    { action: "audit", releaseId }
  ]);
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].releaseId, releaseId);
  assert.equal(lines[0].sourceId, sourceId);
  assert.equal(lines.at(-1)?.type, "end");
});

test("invited recipient receives the same validated package contract", async () => {
  const recipient = {
    id: "recipient-id",
    clerkUserId: "recipient-clerk",
    email: "recipient@example.com",
    displayName: "Recipient"
  };
  const invitedGrant: PrivateReleaseGrant = {
    ...grant,
    accessRole: "invited",
    actorUserId: recipient.id,
    groupId: "33333333-3333-4333-8333-333333333333",
    skillItemId: "44444444-4444-4444-8444-444444444444"
  };
  let audited = false;
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async requirePortalUser() { return recipient; },
      async authorize(receivedActor) {
        assert.equal(receivedActor.id, recipient.id);
        return invitedGrant;
      },
      async recordContentFetch(receivedGrant) {
        assert.equal(receivedGrant.accessRole, "invited");
        audited = true;
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(releaseId), true);
  assert.equal(audited, true);
});

test("authentication and malformed IDs fail before release access", async () => {
  let calls = 0;
  const malformed = await portalPrivateReleases(
    new Request("https://omgskills.com/api/portal/private-releases/path-injection/package"),
    context,
    dependencies({
      async authorize() { calls += 1; throw new Error("must not run"); }
    })
  );
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);

  const unauthorized = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async requirePortalUser() { throw new Response("Unauthorized", { status: 401 }); }
    })
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
});

test("absent and unauthorized releases are indistinguishable before broker access", async () => {
  const responses: Array<{ status: number; body: unknown; cache: string | null }> = [];
  for (const reason of ["absent", "unauthorized"]) {
    let brokerCalls = 0;
    let auditCalls = 0;
    const response = await portalPrivateReleases(
      new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
      context,
      dependencies({
        async authorize() { throw new PrivateReleaseAccessError(); },
        async loadPackage() { brokerCalls += 1; return fixturePackage(); },
        async recordContentFetch() { auditCalls += 1; }
      })
    );
    responses.push({
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("cache-control")
    });
    assert.equal(brokerCalls, 0, reason);
    assert.equal(auditCalls, 0, reason);
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[0], {
    status: 404,
    body: { error: "Private release is unavailable" },
    cache: "no-store"
  });
});

test("GitHub rate limits return a bounded retry and no package body", async () => {
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async loadPackage() {
        throw new GitHubBrokerError("rate_limited", "limited", 60);
      }
    })
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), { error: "GitHub is temporarily unavailable" });
});

test("revocation during package fetch fails before audit or response bytes", async () => {
  let authorizationCount = 0;
  let audited = false;
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async authorize() {
        authorizationCount += 1;
        if (authorizationCount === 2) throw new PrivateReleaseAccessError();
        return grant;
      },
      async recordContentFetch() { audited = true; }
    })
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Private release is unavailable" });
  assert.equal(audited, false);
});

test("group or release substitution during package fetch fails before audit", async () => {
  let authorizationCount = 0;
  let audited = false;
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async authorize() {
        authorizationCount += 1;
        return authorizationCount === 1
          ? grant
          : { ...grant, sourceId: "55555555-5555-4555-8555-555555555555" };
      },
      async recordContentFetch() { audited = true; }
    })
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Private release is unavailable" });
  assert.equal(audited, false);
});

test("audit failure fails closed after validation", async () => {
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async recordContentFetch() { throw new Error("audit unavailable"); }
    })
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Private release request failed" });
});

test("private package delivery uses the bounded Netlify edge rate limit", () => {
  assert.deepEqual(config.rateLimit, {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 10,
    windowSize: 60
  });
});
