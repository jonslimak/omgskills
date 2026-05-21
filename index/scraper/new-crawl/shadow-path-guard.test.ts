import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  assertShadowPath,
  indexRoot,
  isShadowPathAllowed,
  shadowRoot,
} from "./shadow-path-guard.js";

test("allows a direct shadow output file", () => {
  const path = join(shadowRoot, "skills.shadow.json");
  assert.equal(isShadowPathAllowed(path), true);
  assert.doesNotThrow(() => assertShadowPath(path));
});

test("allows nested shadow output paths", () => {
  const path = join(shadowRoot, "nested", "report.json");
  assert.equal(isShadowPathAllowed(path), true);
  assert.doesNotThrow(() => assertShadowPath(path));
});

test("rejects index/skills.json", () => {
  const path = join(indexRoot, "skills.json");
  assert.equal(isShadowPathAllowed(path), false);
  assert.throws(() => assertShadowPath(path), /production path/);
});

test("rejects index/skill-signals.json", () => {
  const path = join(indexRoot, "skill-signals.json");
  assert.equal(isShadowPathAllowed(path), false);
  assert.throws(() => assertShadowPath(path), /production path/);
});

test("rejects site/data/manifest.json", () => {
  const path = join(indexRoot, "..", "site", "data", "manifest.json");
  assert.equal(isShadowPathAllowed(path), false);
  assert.throws(() => assertShadowPath(path), /production path/);
});

test("rejects sibling files outside index/shadow", () => {
  const path = join(indexRoot, "foo.json");
  assert.equal(isShadowPathAllowed(path), false);
  assert.throws(() => assertShadowPath(path), /outside index\/shadow/);
});
