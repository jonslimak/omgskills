import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addAgentLink, installSavedLink, matchVersionsLink, removeFromMacLink } from "../src/app/unified/model";

test("Delete from my Mac opens the app with only the skill's name", () => {
  assert.equal(removeFromMacLink(["humanizer"]), "omgskills://remove?name=humanizer");
  assert.equal(removeFromMacLink(["ship it & more/../x"]), "omgskills://remove?name=ship%20it%20%26%20more%2F..%2Fx");
  assert.equal(removeFromMacLink(["a", "b", " A ", ""]), "omgskills://remove?name=a&name=b", "one entry per skill name");
});

test("the delete action is only on skills a Mac has now, in My skills, for the account owner", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const liveCopies = !discovery \? liveCopiesOf\(skill\) : undefined;/);
  assert.match(source, /\(!readOnlyAccount \|\| management\) && liveCopies && <MenuItem icon=\{Trash2\} danger\s+onSelect=\{\(\) => deleteFromMac\(\[liveCopies\.name\]\)\}>/);
});

test("Edit can delete the selected skills a Mac has now, in one link", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\.flatMap\(skill => liveCopiesOf\(skill\)\?\.name \?\? \[\]\)/);
  assert.match(source, /disabled=\{!names\.length \|\| tooMany\}/);
  assert.match(source, /onClick=\{\(\) => deleteFromMac\(names\)\}/);
});

test("Make versions match opens the app for a skill whose agents have different versions", () => {
  assert.equal(matchVersionsLink(" humanizer "), "omgskills://match?name=humanizer");
  assert.equal(matchVersionsLink("a&b"), "omgskills://match?name=a%26b");
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /liveCopies && versionCount > 1 && <MenuItem icon=\{RefreshCw\}/);
  assert.match(source, /detailVersions\.length > 1 && detailLive && \(!readOnlyAccount \|\| management\) && <button/);
});

test("Install opens the app for a synced personal skill no Mac has, with its name and saved key", () => {
  assert.equal(installSavedLink(" my notes ", "notes@codex"), "omgskills://install-saved?name=my%20notes&key=notes%40codex");
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const savedInstall = !!\(onMac && signedIn && \(!readOnlyAccount \|\| management\) && detail\?\.cloudKey && !detail\.catalogId\);/);
  assert.match(source, /onClick=\{\(\) => window\.location\.assign\(installSavedLink\(detail\.name, detail\.cloudKey!\)\)\}/);
});

test("+ on a personal skill opens the Mac app with only the skill's name", () => {
  assert.equal(addAgentLink(" my notes "), "omgskills://add-agent?name=my%20notes");
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => window\.location\.assign\(addAgentLink\(detailLive\.name\)\)\}/);
  assert.match(source, /const localAddAgent = [^;]*missingAgent && !canInstall[^;]*macAddsAgent\(data\.devices\)/);
});

test("the panel's trash removes one skill from My skills or the Mac, without Edit", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(discovery \|\| \(!savable && !onThisMac\)\) return null;/, "My skills only, and only when one choice applies");
  assert.match(source, /<MenuItem icon=\{X\} disabled=\{!!detail\.installed\} onSelect=\{\(\) => setRemoving\(\[detail\]\)\}>/, "same confirm as Edit; a skill on a Mac stays");
  assert.match(source, /onSelect=\{\(\) => deleteFromMac\(\[detailLive!\.name\]\)\}>/, "the Mac app asks before it deletes");
  assert.match(source, /const savable = editableView && !detail\.setItemKind && !!\(cloud\?\.remove \|\| additions\)\s+&& !!\(detail\.cloudKey \|\| \(detail\.added && detail\.catalogId\)\) && \(!detail\.installed \|\| onThisMac\);/, "same skills as Edit's Remove from My skills");
  assert.match(source, /if \(selected && keys\.includes\(selected\.key\) && !discovery\) closeDetail\(\);\s+const results = await/, "the panel closes before the request, never after the view changed");
});

test("deletes confirm with a red toast: at once for My skills, after the Mac's check-in for the Mac", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /macDeletes\.current = \{ names: \[\.\.\.new Set\(\[\.\.\.waiting, \.\.\.names\]\)\], until: Date\.now\(\) \+ 10 \* 60_000 \};\s+window\.location\.assign\(removeFromMacLink\(names\)\);/, "a second delete keeps the first one's toast");
  assert.match(source, /if \(!onMacKey && !macSeen\) return;/, "an empty list with no Mac isn't a delete; the Mac deleting its last skill is");
  assert.match(source, /const gone = pending\.names\.filter\(name => !still\.has\(name\.trim\(\)\.toLowerCase\(\)\)\);/);
  assert.match(source, /setDeletedNotice\(skills\.length === 1 \? `Removed \$\{skills\[0\]\.name\}`/);
  assert.match(source, /<div className="ua-toast ua-toast-danger" role="status">/);
  assert.equal(source.match(/removeFromMacLink\(/g)?.length, 1, "every Mac delete goes through deleteFromMac");
});
