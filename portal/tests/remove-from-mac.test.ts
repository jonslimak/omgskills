import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { removeFromMacLink } from "../src/app/unified/model";

test("Delete from my Mac opens the app with only the skill's name", () => {
  assert.equal(removeFromMacLink("humanizer"), "omgskills://remove?name=humanizer");
  assert.equal(removeFromMacLink("ship it & more/../x"), "omgskills://remove?name=ship%20it%20%26%20more%2F..%2Fx");
});

test("the delete action is only on skills a Mac has now, in My skills, for the account owner", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const liveCopies = !discovery \? liveCopiesOf\(skill\) : undefined;/);
  assert.match(source, /\(!readOnlyAccount \|\| management\) && liveCopies && <MenuItem icon=\{Trash2\} danger\s+onSelect=\{\(\) => window\.location\.assign\(removeFromMacLink\(liveCopies\.name\)\)\}>/);
});
