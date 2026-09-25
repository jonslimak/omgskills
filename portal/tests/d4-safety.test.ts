import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isLocalIntegration, integrationConfigurationError } from "../src/integration/gate";
import { isLocalPreview } from "../src/app/preview-gate";
import { portalSurface } from "../src/feature-flags";
import { parseRoute } from "../src/app/routes";
import { isIntegrationRequest } from "../integration-config";
import { parseBrowserPairingRequest } from "../src/browser-pairing";
import { makeFixtures } from "../src/preview/fixtures";
import { SetDetailPage } from "../src/app/SetDetailPage";
import { loadSetData } from "../src/integration/data";
import type { PortalActions } from "../src/app/model";

test("D4 development routes cannot capture connect or activate on production hosts/builds", () => {
  for (const [gate, prefix] of [[isLocalPreview, "preview"], [isLocalIntegration, "integration"]] as const) {
    for (const development of [true, false]) for (const hostname of ["127.0.0.1", "omgskills.com", "app.omgskills.com"]) {
      for (const pathname of [`/app/${prefix}/home`, "/app/connect", "/app/connect/", "/connect", "/app/groups/example"])
        assert.equal(gate({ development, hostname, pathname, enabled: "1" }),
          development && hostname === "127.0.0.1" && pathname === `/app/${prefix}/home`);
    }
  }
  for (const pathname of ["/app/", "/app/connect", "/app/groups/example"]) {
    assert.equal(portalSurface(pathname, false), "disabled");
    assert.equal(portalSurface(pathname, true), pathname === "/app/connect" ? "connect" : "dashboard");
  }
  assert.ok(integrationConfigurationError({ ready: true, publishableKey: "pk_test_fixture", webEnabled: "0" }));
});

test("D4 both redesigned route bases preserve detail identity without swallowing connect", () => {
  for (const base of ["/app/preview/", "/app/integration/"]) {
    assert.deepEqual(parseRoute(`${base}groups/fixture-123/`, "?source=Codex", base), { page: "detail", groupId: "fixture-123", source: "Codex" });
    assert.equal(parseRoute(`${base}groups/%ZZ`, "", base).page, "missing");
    assert.equal(parseRoute("/app/connect", "", base).page, "missing");
    assert.equal(parseRoute("/app/groups/existing", "", base).page, "missing");
  }
});

test("D4 local UI cannot exchange credentials, upload skills or retrieve install packages", () => {
  for (const path of ["/api/portal/sync-exchange", "/api/portal/device-exchange", "/api/portal/sync-upload",
    "/api/device/groups/owner/set/manifest", "/api/portal/groups/id/manifest",
    "/api/portal/private-releases/d4000000-0000-4000-8000-000000000001/package"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal(isIntegrationRequest(path, method), false);
  }
});

test("D4 shared readers receive neither owner mappings nor access records or edit actions", async () => {
  const fixture = makeFixtures().sets[1];
  for (const role of ["invited", "public"] as const) {
    const data = await loadSetData(async <T>() => ({ group: { ...fixture, allowedEmails: [{ id: "secret", email: "owner-only@example.test" }] },
      accessRole: role, items: fixture.items.map((item, position) => ({ ...item, position })) }) as T, fixture.id);
    assert.equal(data.allowedEmails, undefined);
    assert.deepEqual(data.emails, []);
    assert.ok(data.items.every((item) => item.syncedSkillId === null));
    const html = renderToStaticMarkup(createElement(SetDetailPage, {
      set: data, sets: [], skills: [], edit: true, readOnly: true, actions: {} as PortalActions,
      addSkills() {}, notify() {}, star() {}, newSet() {},
    }));
    assert.match(html, /read-only access/);
    assert.doesNotMatch(html, /owner-only@example|Add email|Remove access|Move .* up|Add skills|omgskills:\/\//);
  }
});

test("D4 browser pairing preserves its fragment contract without performing a callback", () => {
  const state = "s".repeat(43), challenge = "c".repeat(43);
  const url = new URL(`http://127.0.0.1/app/connect#state=${state}&code_challenge=${challenge}`);
  assert.equal(url.search, "");
  assert.deepEqual(parseBrowserPairingRequest(url.hash), { state, codeChallenge: challenge, scopes: ["sync:write", "self:revoke"] });
  assert.equal(parseBrowserPairingRequest(`${url.hash}&state=${state}`), null);
});

test("D4 production composition keeps the Mac install switch separate from the web switch", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../src/groups/GroupDetailPage.tsx", import.meta.url), "utf8");
  assert.match(main, /installEnabled=\{skillGroupsMacEnabled\}/);
  assert.match(detail, /installEnabled && group\.appDeepLink/);
  const integration = await readFile(new URL("../src/account/PortalSession.tsx", import.meta.url), "utf8");
  assert.match(integration, /key=\{`\$\{local\}:\$\{base\}:\$\{userId\}:\$\{sessionId\}`\}/);
  assert.match(integration, /forceRedirectUrl=\{window\.location\.href\}/);
});
