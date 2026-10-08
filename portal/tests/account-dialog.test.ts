import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("production profile wiring separates pending work from an unconfirmed save", () => {
  const source = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(source, /busy=\{snapshot\.profileSaving \|\| snapshot\.setSaving \|\| snapshot\.refreshing\}/);
  assert.match(source, /blocked=\{!!snapshot\.error \|\| !snapshot\.data \|\| snapshot\.accessDenied\}/);
});

test("production device dialogs receive the unified theme", () => {
  const source = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(source, /<DevicesPanel[^>]*theme=\{theme\}/);
});

test("account buttons and device dividers use theme colors", () => {
  const css = readFileSync(new URL("../src/app/redesign.css", import.meta.url), "utf8");
  const action = css.match(/\.portal-design \.rd-action \{([^}]+)\}/)?.[1] ?? "";
  const row = css.match(/\.rd-agent-row \{([^}]+)\}/)?.[1] ?? "";
  assert.match(action, /background: var\(--background\);/);
  assert.match(row, /border-bottom: 1px solid var\(--rd-row-divider, #f4f4f5\);/);
  const unified = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  const dark = unified.match(/\.ua-theme\[data-theme="dark"\] \{([^}]+)\}/)?.[1] ?? "";
  assert.match(dark, /--rd-row-divider: var\(--ua-line\);/);
  assert.match(dark, /--ua-danger: #ff6b6b;/);
  const panel = unified.match(/\.ua-connected-panel\.portal-design \{([^}]+)\}/)?.[1] ?? "";
  assert.match(panel, /--destructive: var\(--ua-danger\);/);
});
