import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadPrivateSources,
  registerPrivateRelease,
  registerPrivateSource
} from "../src/private-sources/api.js";
import type { PortalApi } from "../src/portal-api.js";

type Call = { path: string; init?: RequestInit };

function recordingApi(response: unknown, calls: Call[]): PortalApi {
  return async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return response as T;
  };
}

test("private-source adapters preserve the owner-only endpoint contract", async () => {
  const calls: Call[] = [];
  const api = recordingApi({
    installations: [],
    sources: [],
    source: { id: "source-id" },
    release: { id: "release-id" }
  }, calls);

  await loadPrivateSources(api);
  await registerPrivateSource(api, {
    installationId: "456",
    repositoryId: "321",
    root: "skills/example"
  });
  await registerPrivateRelease(api, "11111111-1111-4111-8111-111111111111");

  assert.deepEqual(calls.map(({ path, init }) => ({
    path,
    method: init?.method,
    body: init?.body ? JSON.parse(String(init.body)) : null
  })), [
    { path: "/api/portal/private-sources", method: undefined, body: null },
    {
      path: "/api/portal/private-sources",
      method: "POST",
      body: { installationId: "456", repositoryId: "321", root: "skills/example" }
    },
    {
      path: "/api/portal/private-sources/11111111-1111-4111-8111-111111111111/releases",
      method: "POST",
      body: null
    }
  ]);
});

test("private sources remain behind the existing Skill Groups kill switch", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const panel = await readFile(
    new URL("../src/private-sources/PrivateSourcesPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(main, /skillGroupsAuthEnabled \? <PrivateSourcesPanel \/>/);
  assert.match(panel, /aria-label="Private repository"/);
  assert.match(panel, /aria-label="Skill root"/);
  assert.match(panel, /Create release/);
  assert.doesNotMatch(panel, /token|privateKey|authorization/i);
});
