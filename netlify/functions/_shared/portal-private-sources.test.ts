import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import {
  portalPrivateSources,
  type PortalPrivateSourcesDependencies
} from "../portal-private-sources.mjs";

const context = { deploy: { context: "production" }, params: {} } as Context;
const actor = { id: "owner-id", clerkUserId: "clerk-id", email: "owner@example.com", displayName: "Owner" };

function dependencies(overrides: Partial<PortalPrivateSourcesDependencies> = {}): PortalPrivateSourcesDependencies {
  return {
    async requirePortalUser() { return actor; },
    async readView() { return { installations: [], sources: [] }; },
    async register(_ownerUserId, input) {
      return {
        id: "source-id",
        installationId: input.installationId,
        repositoryId: input.repositoryId,
        repositorySlug: "owner/private-skills",
        normalizedRoot: String(input.root),
        createdAt: "2026-08-27T00:00:00Z"
      };
    },
    ...overrides
  };
}

test("GET requires the portal owner and returns private no-store metadata", async () => {
  let receivedOwner = "";
  const response = await portalPrivateSources(
    new Request("https://omgskills.com/api/portal/private-sources"),
    context,
    dependencies({
      async readView(ownerUserId) {
        receivedOwner = ownerUserId;
        return { installations: [], sources: [] };
      }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(receivedOwner, "owner-id");
});

test("POST passes only the authenticated owner and normalized request fields", async () => {
  let received: unknown;
  const response = await portalPrivateSources(
    new Request("https://omgskills.com/api/portal/private-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId: "456", repositoryId: "321", root: "skills/example", ownerUserId: "attacker" })
    }),
    context,
    dependencies({
      async register(ownerUserId, input) {
        received = { ownerUserId, ...input };
        return {
          id: "source-id",
          installationId: input.installationId,
          repositoryId: input.repositoryId,
          repositorySlug: "owner/private-skills",
          normalizedRoot: String(input.root),
          createdAt: "2026-08-27T00:00:00Z"
        };
      }
    })
  );
  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    ownerUserId: "owner-id",
    installationId: "456",
    repositoryId: "321",
    root: "skills/example"
  });
});

test("unauthenticated and unsupported requests fail without broker initialization", async () => {
  const unauthenticated = await portalPrivateSources(
    new Request("https://omgskills.com/api/portal/private-sources"),
    context,
    dependencies({
      async requirePortalUser() { throw new Response("Unauthorized", { status: 401 }); }
    })
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

  const unsupported = await portalPrivateSources(
    new Request("https://omgskills.com/api/portal/private-sources", { method: "DELETE" }),
    context
  );
  assert.equal(unsupported.status, 405);
});

test("POST rejects malformed GitHub IDs before registration", async () => {
  let registered = false;
  const response = await portalPrivateSources(
    new Request("https://omgskills.com/api/portal/private-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId: "spoofed", repositoryId: "321", root: "." })
    }),
    context,
    dependencies({
      async register() {
        registered = true;
        throw new Error("must not run");
      }
    })
  );
  assert.equal(response.status, 400);
  assert.equal(registered, false);
});
