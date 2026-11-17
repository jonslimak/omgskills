import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addAgentLink, installSavedLink, matchVersionsLink, removeFromMacLink } from "../src/app/unified/model";

test("Delete from my Mac opens the app with only the skill's name", () => {
  assert.equal(removeFromMacLink(["humanizer"]), "omgskills://remove?name=humanizer");
  assert.equal(removeFromMacLink(["ship it & more/../x"]), "omgskills://remove?name=ship%20it%20%26%20more%2F..%2Fx");
  assert.equal(removeFromMacLink(["a", "b", " A ", ""]), "omgskills://remove?name=a&name=b", "one entry per skill name");
  assert.equal(removeFromMacLink(["a"], "mac"), "omgskills://remove?name=a&from=mac", "the website chose this Mac");
  assert.equal(removeFromMacLink(["a"], "everywhere"), "omgskills://remove?name=a&from=everywhere", "the website chose My skills and this Mac");
});

test("the delete action is only on skills a Mac has now, in My skills, for the account owner", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const liveCopies = !discovery \? liveCopiesOf\(skill\) : undefined;/);
  assert.match(source, /\(!readOnlyAccount \|\| management\) && liveCopies && <MenuItem icon=\{Trash2\} danger\s+onSelect=\{\(\) => setRemovingFromMac\(\{ names: \[liveCopies\.name\], skill \}\)\}>/);
});

test("Edit can delete the selected skills a Mac has now, in one link", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\.flatMap\(skill => liveCopiesOf\(skill\)\?\.name \?\? \[\]\)/);
  assert.match(source, /disabled=\{!names\.length && !savedOnly\.length\}/, "too many Mac skills doesn't block the saved ones");
  assert.match(source, /: names\.length > maxRemoveFromMac \? <>/, "too many for one Mac link: the pop-up says so");
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
  assert.match(source, /<IconButton label=\{`Remove \$\{detail\.name\}`\} onClick=\{\(\) => setRemovingFromMac\(\{ names: \[detailLive\.name\], skill: detail \}\)\}>/, "on a Mac: the pop-up asks where");
  assert.match(source, /const target = discovery && detail\.catalogId \? allMine\.find\(skill => skill\.catalogId === detail\.catalogId\) \?\? detail : detail;/, "Discover removes what My skills has");
  assert.match(source, /return !target\.installed && !adding && \(cloud\?\.remove \|\| additions\) && \(target\.cloudKey \|\| inMySkills\(target\.catalogId\)\) && \(\s+<IconButton label="Remove from My skills" onClick=\{\(\) => setRemoving\(\[target\]\)\}>/, "not on a Mac: same confirm as Edit, not while still adding");
  assert.equal(source.includes("<Check aria-hidden=\"true\" />In My skills"), false, "no In My skills button");
  assert.match(source, /if \(selected && keys\.includes\(selected\.key\) && !discovery\) closeDetail\(\);\s+const results = await/, "the panel closes before the request, never after the view changed");
});

test("deletes confirm with a red toast: at once for My skills, after the Mac's check-in for the Mac", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /macDeletes\.current = \{ names: \[\.\.\.new Set\(\[\.\.\.\(waiting\?\.names \?\? \[\]\), \.\.\.names\]\)\], everywhere: \[\.\.\.everywhere\], until: Date\.now\(\) \+ 10 \* 60_000 \};\s+window\.location\.assign\(removeFromMacLink\(names, from\)\);/, "a second delete keeps the first one's toast");
  assert.match(source, /if \(!onMacKey && !macSeen\) return;/, "an empty list with no Mac isn't a delete; the Mac deleting its last skill is");
  assert.match(source, /const gone = pending\.names\.filter\(name => !still\.has\(name\.trim\(\)\.toLowerCase\(\)\)\);/);
  assert.match(source, /setDeletedNotice\(`Removed \$\{skills\.length === 1 \? skills\[0\]\.name : `\$\{skills\.length\} skills`\} from My skills`\);/);
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

test("removing a skill on a Mac asks in a centered pop-up: This device, or This device and My skills", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => removeFromMac\(names, "mac"\)\}>\s+This device<\/button>/);
  assert.match(source, /onClick=\{\(\) => removeFromMac\(names, "everywhere"\)\}>\s+This device and My skills<\/button>/);
  assert.match(source, /deleteFromMac\(names, macTakesChoice \? from : undefined\);/, "older Macs get the plain link and ask again");
});

test("in Discover, Add to set leaves the panel's action row when it can't fit on one line, and comes back with room", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const setFits = !discovery \|\| setDroppedAt === null;/);
  assert.match(source, /if \(at !== null\) return width > at \+ 38 \? null : at;/);
  assert.match(source, /settable\(detail\)\) && setFits && \(/);
});

test("removing a skill no Mac has uses the same centered pop-up, one red button, and works without the Mac app", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /<Modal title=\{removing\.length === 1 \? "Remove skill" : `Remove \$\{removing\.length\} skills`\}/);
  assert.match(source, /\{removing\.length === 1 && <PopupSkill name=\{removing\[0\]\.name\} skill=\{removing\[0\]\} \/>\}/);
  assert.match(source, /onClick=\{\(\) => void removeSaved\(removing\)\}>\s+Remove from My skills<\/button>/);
});

test("a skill whose source can't be found shows a package-question icon at the end, not a Source unavailable pill", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /statusLabel === "Source unavailable" \? "Source unavailable" : undefined;/);
  assert.match(source, /kindLabel === "Source unavailable" \? PackageQuestionMark : null;/);
  assert.match(source, /statusLabel && statusLabel !== kindLabel && <span className="ua-pill">/, "the pill hides when the icon says it");
});

test("away from a Mac, removing a skill a Mac has explains it can't be done remotely, with just OK", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /\{!onMac \? <>\s+<p className="ua-muted">For your safety, skills can't be removed from your Mac remotely\. Open omgskills on your Mac to remove/);
  assert.match(source, /onClick=\{\(\) => setRemovingFromMac\(null\)\}>OK<\/button>/);
});

test("Edit has one Remove: Mac skills go through the Mac pop-up, saved-only ones are removed by the website", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Delete from Mac</);
  assert.match(source, /onClick=\{\(\) => names\.length \? setRemovingFromMac\(\{ names, skill: one, saved: savedOnly \}\) : setRemoving\(savedOnly\)\}>\s+<Trash2 \/>Remove/);
  assert.match(source, /void removeSaved\(saved\); \}\}>\s+Remove the \{saved\.length\} not on a Mac from My skills<\/button>\s+<\/div>\s+<p className="ua-muted ua-modal-note">\{removeWarning\(saved\)\}<\/p>/,
    "saved ones picked with Mac ones: their own button and warning, never tied to the Mac's confirm");
});
