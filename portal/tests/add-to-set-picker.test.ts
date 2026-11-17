import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setStatus } from "../src/integration/unified/set-adds";
import type { PortalSet } from "../src/app/model";
import type { SkillDisplay } from "../src/app/unified/model";

const source = readFileSync(new URL("../src/integration/unified/useManagement.tsx", import.meta.url), "utf8");

test("Add to set lists the sets right away, several can be picked", () => {
  assert.doesNotMatch(source, /<option value="">Choose a set<\/option>/);
  assert.match(source, /className="ua-set-picker" role="group"/);
  assert.match(source, /type="checkbox" value=\{set\.id\} checked=\{!has && setIds\.includes\(set\.id\)\}/);
  // Each picked set is saved; a failed one stays picked to try again.
  assert.match(source, /for \(const \[index, set\] of targetSets\.entries\(\)\)/);
  // A thrown or unsure save stops the loop; the sets not tried stay picked.
  assert.match(source, /failed\.push\(\.\.\.targetSets\.slice\(index \+ 1\)\.map\(rest => rest\.id\)\)/);
  assert.match(source, /toastText = `Added \$\{what\} to \$\{added\.length === 1 \? added\[0\] : `\$\{added\.length\} sets`\}`/);
  assert.match(source, /"\. The rest already had it\."/);
  assert.match(source, /setSetIds\(failed\)/);
  assert.match(source, /`Add to \$\{targetSets\.length\} sets`/);
  // A set that already has the skill can't be picked; Add stays off until a set is picked.
  assert.match(source, /disabled=\{disabled \|\| has\}/);
  assert.match(source, /setIds\.includes\(set\.id\) && !hasAll\(set\)/);
  assert.match(source, /request\.kind === "add" && \(!targetSets\.length \|\| !targetSkills\.length\)/);
  // Only sets the person owns, not Favorites or hidden ones.
  assert.match(source, /const owned = data\.sets\.filter\(set => set\.role === "owner" && !set\.isFavorites && !set\.hidden\)/);
  assert.match(source, /show\(\{ kind: "create", skills: request\.skills \}\)/);
});

test("a saved skill in a Set list without items is unknown, not missing", () => {
  const summary = { items: [], itemCount: 3 } as unknown as PortalSet;
  const saved = { key: "c", name: "x", catalogId: "o/r/x" } as SkillDisplay;
  assert.equal(setStatus(summary, saved), null);
  assert.equal(setStatus({ items: [], itemCount: 0 } as unknown as PortalSet, saved), false);
  assert.equal(setStatus({ items: [{ catalogSkillId: "o/r/x" }], itemCount: 1 } as unknown as PortalSet, saved), true);
});

test("adding to or removing from a set confirms with a toast", () => {
  assert.match(source, /toastText = `Removed \$\{request\.skill\.name\} from \$\{request\.set\.name\}`/);
  assert.match(source, /setToast\(\{ text: toastText, id: Date\.now\(\) \}\)/);
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(app, /management\?\.toast && \(\s*<div key=\{management\.toast\.id\} className="ua-toast ua-toast-success" role="status">/);
});
