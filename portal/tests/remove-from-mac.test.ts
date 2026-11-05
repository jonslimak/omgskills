import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchVersionsLink, removeFromMacLink } from "../src/app/unified/model";

test("Delete from my Mac opens the app with only the skill's name", () => {
  assert.equal(removeFromMacLink(["humanizer"]), "omgskills://remove?name=humanizer");
  assert.equal(removeFromMacLink(["ship it & more/../x"]), "omgskills://remove?name=ship%20it%20%26%20more%2F..%2Fx");
  assert.equal(removeFromMacLink(["a", "b", " A ", ""]), "omgskills://remove?name=a&name=b", "one entry per skill name");
});

test("the delete action is only on skills a Mac has now, in My skills, for the account owner", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const liveCopies = !discovery \? liveCopiesOf\(skill\) : undefined;/);
  assert.match(source, /\(!readOnlyAccount \|\| management\) && liveCopies && <MenuItem icon=\{Trash2\} danger\s+onSelect=\{\(\) => window\.location\.assign\(removeFromMacLink\(\[liveCopies\.name\]\)\)\}>/);
});

test("Edit can delete the selected skills a Mac has now, in one link", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\.flatMap\(skill => liveCopiesOf\(skill\)\?\.name \?\? \[\]\)/);
  assert.match(source, /disabled=\{!names\.length \|\| tooMany\}/);
  assert.match(source, /onClick=\{\(\) => window\.location\.assign\(removeFromMacLink\(names\)\)\}/);
});

test("Make versions match opens the app for a skill whose agents have different versions", () => {
  assert.equal(matchVersionsLink(" humanizer "), "omgskills://match?name=humanizer");
  assert.equal(matchVersionsLink("a&b"), "omgskills://match?name=a%26b");
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /liveCopies && versionCount > 1 && <MenuItem icon=\{RefreshCw\}/);
  assert.match(source, /detailVersions\.length > 1 && detailLive && \(!readOnlyAccount \|\| management\) && <button/);
});
