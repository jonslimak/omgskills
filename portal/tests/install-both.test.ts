import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { macAddsAgent, macInstallsBoth, type PortalDevice } from "../src/app/model";
import { catalogInstallAction } from "../src/app/unified/public-install";
import { CatalogInstallIntentStore } from "../src/app/unified/catalog-install-intent";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { CatalogInstallSetup as Setup } from "../src/app/unified/CatalogInstallSetup";
import { installAckPath } from "../src/app/unified/install-ack";
import type { SkillDisplay } from "../src/app/unified/model";

const mac = (extra: Partial<PortalDevice>): PortalDevice => ({ id: "m", name: "Mac", lastActive: "", status: "active", ...extra });

test("Both is offered only when every connected Mac is build 41 or later", () => {
  assert.equal(macInstallsBoth([]), false);
  assert.equal(macInstallsBoth([mac({ appBuild: 41 })]), true);
  assert.equal(macInstallsBoth([mac({ appBuild: 40 })]), false);
  assert.equal(macInstallsBoth([mac({})]), false);
  assert.equal(macInstallsBoth([mac({ appBuild: 41 }), mac({ id: "old", appBuild: null })]), false);
  // A disconnected old Mac doesn't count.
  assert.equal(macInstallsBoth([mac({ appBuild: 42 }), mac({ id: "old", status: "revoked" })]), true);
});

test("+ on a personal skill waits for every connected Mac to be build 42 or later", () => {
  assert.equal(macAddsAgent([]), false);
  assert.equal(macAddsAgent([mac({ appBuild: 41 })]), false);
  assert.equal(macAddsAgent([mac({ appBuild: 42 })]), true);
  assert.equal(macAddsAgent([mac({ appBuild: 42 }), mac({ id: "old", appBuild: 41 })]), false);
  assert.equal(macAddsAgent([mac({ appBuild: 42 }), mac({ id: "old", status: "revoked" })]), true);
});

test("A Mac connection that never checked in, or not for a week, doesn't hold back the others", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const today = mac({ appBuild: 42, lastCheckedAt: "2026-11-15T11:00:00Z", lastReportedAt: "2026-11-15T11:00:00Z" });
  const never = mac({ id: "never", lastCheckedAt: null, lastReportedAt: null, appBuild: null });
  const stale = mac({ id: "stale", lastCheckedAt: "2026-11-01T11:00:00Z", lastReportedAt: null, appBuild: null });
  assert.equal(macInstallsBoth([today, never, stale], now), true);
  assert.equal(macAddsAgent([today, never, stale], now), true);
  // A Mac on an old app that checked in this week still holds it back.
  const old = mac({ id: "old", lastCheckedAt: "2026-11-15T10:00:00Z", lastReportedAt: null, appBuild: null });
  assert.equal(macInstallsBoth([today, old], now), false);
  assert.equal(macAddsAgent([today, old], now), false);
  // No Mac with the app: nothing to offer.
  assert.equal(macInstallsBoth([never], now), false);
});

const skill = { key: "catalog:anthropics/skills/pdf", catalogId: "anthropics/skills/pdf", name: "pdf" } as SkillDisplay;

test("install links and the ack poll carry agent=both", () => {
  const href = catalogInstallAction(skill, "both", "production").href ?? "";
  assert.equal(new URL(href).searchParams.get("agent"), "both");
  assert.match(installAckPath({ catalogId: "x", agent: "both" }), /agent=both/);
});

function storage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
}

async function loadSetup() {
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/CatalogInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { CatalogInstallSetup: typeof Setup } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports.CatalogInstallSetup;
}
let CatalogInstallSetup: typeof Setup;

const render = (installsBoth: boolean, installed?: string[]) => renderToStaticMarkup(createElement(CatalogInstallSetup, {
  skill: { ...skill, installed: installed ? { sources: installed } : undefined } as SkillDisplay,
  detailReady: true, returnRoute: "/app/?view=discover", store: new CatalogInstallIntentStore(storage, "production"),
  appKnown: true, installsBoth }));
const pressed = (html: string) => /aria-pressed="true"[^>]*>(?:<span[^>]*><\/span>)?([A-Za-z]+)/.exec(html)?.[1];

test("the picker starts on Both where the Mac can, and on the missing agent otherwise", async () => {
  CatalogInstallSetup = await loadSetup();
  assert.doesNotMatch(render(false), />Both</);
  assert.equal(pressed(render(false)), "Claude");
  assert.match(render(true), />Both</);
  assert.equal(pressed(render(true)), "Both");
  assert.equal(pressed(render(true, ["Claude Code"])), "Codex");
  assert.equal(pressed(render(true, ["Codex"])), "Claude");

  // A saved Both, then the Mac can't: dropped, and the pop-over isn't stuck on "out of date".
  const store = new CatalogInstallIntentStore(storage, "production");
  store.save({ version: 1, catalogId: skill.catalogId!, agent: "both", createdAt: Date.now(), returnRoute: "/app/?view=discover&skill=catalog%3Aanthropics%2Fskills%2Fpdf" });
  assert.equal(store.read().intent?.agent, "both");
  const html = renderToStaticMarkup(createElement(CatalogInstallSetup, { skill, detailReady: true, returnRoute: "/app/?view=discover",
    store, appKnown: true, installsBoth: false }));
  assert.equal(store.read().intent, null);
  assert.equal(pressed(html), "Claude");
  assert.doesNotMatch(html, /out of date/);
});
