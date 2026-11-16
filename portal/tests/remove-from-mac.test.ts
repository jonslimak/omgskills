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

test("the panel's trash is one action named for what it does, and In My skills isn't a button", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /<IconButton label="Delete from Mac" title="Delete from Mac \(the Mac app asks first\)"\s+onClick=\{\(\) => deleteFromMac\(\[detailLive\.name\]\)\}>/, "on a Mac: the Mac app asks first");
  assert.match(source, /const target = discovery && detail\.catalogId \? allMine\.find\(skill => skill\.catalogId === detail\.catalogId\) \?\? detail : detail;/, "Discover removes what My skills has");
  assert.match(source, /return !target\.installed && !adding && \(cloud\?\.remove \|\| additions\) && \(target\.cloudKey \|\| inMySkills\(target\.catalogId\)\) && \(\s+<IconButton label="Remove from My skills" onClick=\{\(\) => setRemoving\(\[target\]\)\}>/, "not on a Mac: same confirm as Edit, not while still adding");
  assert.equal(source.includes("<Check aria-hidden=\"true\" />In My skills"), false, "no In My skills button");
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

test("Discover marks skills already in My skills with a quiet My skills tag, not a button", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const inMine = \(skill: SkillDisplay\) => !!skill\.installed \|\| \(!!skill\.catalogId && mineCatalogIds\.has\(skill\.catalogId\)\);/);
  assert.match(source, /!detail\.cloudKey\s+&& !inMySkills\(detail\.catalogId\) && !inMine\(detail\)\);/, "no Add next to the trash for a skill My skills already has");
  assert.match(source, /\{addable && \(\s+<button type="button" className=\{onMac \? "ua-pill ua-detail-copy" : "ua-pill ua-primary"\}/, "off a Mac, Add to My skills is the main button");
  assert.match(source, /className=\{`ua-pill ua-detail-copy-icon \$\{onMac \|\| addable \? "ua-detail-copy" : "ua-primary"\}`\} aria-label="Copy install command"/, "Copy steps back when Add is there");
  assert.equal(source.match(/\{discovery && signedIn && inMine\((skill|detail)\) && <span className="ua-mine-tag">My skills<\/span>\}/g)?.length, 2, "row and panel");
});
