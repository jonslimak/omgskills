import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Context } from "@netlify/functions";
import { GitHubBrokerError } from "./github-broker.js";
import { gitObjectSha, type SkillPackage } from "./skill-package.js";
import {
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

function dependencies(
  overrides: Partial<PortalPrivateReleasesDependencies> = {}
): PortalPrivateReleasesDependencies {
  return {
    async requirePortalUser() { return actor; },
    async register() { return release; },
    async loadPackage() { return { release, package: fixturePackage() }; },
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
  let received: unknown;
  const response = await portalPrivateReleases(
    new Request(`https://omgskills.com/api/portal/private-releases/${releaseId}/package`),
    context,
    dependencies({
      async loadPackage(ownerUserId, receivedReleaseId) {
        received = { ownerUserId, releaseId: receivedReleaseId };
        return { release, package: fixturePackage() };
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.deepEqual(received, { ownerUserId: "owner-id", releaseId });
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].releaseId, releaseId);
  assert.equal(lines[0].sourceId, sourceId);
  assert.equal(lines.at(-1)?.type, "end");
});

test("authentication and malformed IDs fail before release access", async () => {
  let calls = 0;
  const malformed = await portalPrivateReleases(
    new Request("https://omgskills.com/api/portal/private-releases/path-injection/package"),
    context,
    dependencies({
      async loadPackage() { calls += 1; throw new Error("must not run"); }
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
