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
