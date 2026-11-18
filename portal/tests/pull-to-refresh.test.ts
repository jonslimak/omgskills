import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PULL_MAX, PULL_REFRESH, pullDistance } from "../src/app/unified/PullToRefresh";

test("a pull follows the finger with growing resistance, never stopping dead", () => {
  assert.equal(pullDistance(-20), 0);
  assert.ok(pullDistance(40) > 15 && pullDistance(40) < 40);
  // A comfortable thumb pull refreshes.
  assert.ok(pullDistance(180) >= PULL_REFRESH);
  // Still moving far down, never past the limit.
  assert.ok(pullDistance(600) > pullDistance(400));
  assert.ok(pullDistance(5000) < PULL_MAX);
});

test("phones get pull to refresh on the main pane, which reloads the data in place", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<PullToRefresh scroller=\{main\} enabled=\{phone && !picked\.length && !management\?\.busy\} onRefresh=\{refresh\} \/>/);
  const session = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(session, /refresh=\{available \? account\.reload : undefined\}/);
  const source = readFileSync(new URL("../src/app/unified/PullToRefresh.tsx", import.meta.url), "utf8");
  // No page reload (a white screen and the page loader); the spinner turns until the data is in.
  assert.doesNotMatch(source, /location\.reload/);
  assert.match(source, /Promise\.resolve\(\)\.then\(\(\) => refresh\.current\?\.\(\)\)\.catch\(\(\) => \{\}\)/);
  assert.match(source, /setTimeout\(resolve, PULL_MAX_SPIN\)/);
  assert.match(source, /Promise\.all\(\[answer, minimum\]\)/);
  // Signed out there's nothing to reload, so no pull; a refresh under way keeps its spinner.
  assert.match(source, /if \(!element \|\| !enabled \|\| !refresh\.current\) return;/);
  assert.match(source, /if \(!refreshing && \(!enabled \|\| !pull\)\) return null;/);
  // No second pull while one is refreshing.
  assert.match(source, /!busy\.current \? event\.touches\[0\]\.clientY/);
  // Only starts at the top of the page.
  assert.match(source, /element\.scrollTop <= 0/);
  // The spinner stays under the search bar, not on the stretching page.
  assert.match(source, /setTop\(element\.getBoundingClientRect\(\)\.top\)/);
  // The page follows the finger, then stays down just enough for the spinner while refreshing.
  assert.match(source, /element\.style\.setProperty\("--ua-ptr", `\$\{refreshing \? PULL_GAP : pull\}px`\)/);
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(css, /\.ua-main\[data-ptr\] > \.ua-content \{\s*transform: translateY\(var\(--ua-ptr, 0px\)\)/);
  // The A–Z rail keeps its drag; a gesture the browser already took is left to it.
  assert.match(source, /closest\("\.ua-az-anchor"\)/);
  assert.match(source, /if \(!event\.cancelable\) \{ startY = null; return; \}/);
  // Sideways swipes are left to the page: decided once, before anything is blocked.
  assert.match(source, /if \(!pulling\) \{/);
  assert.match(source, /if \(dy <= 0 \|\| dx > dy \|\| element\.scrollTop > 0\) \{ startY = null; return; \}/);
});

test("a refresh keeps the open Set on screen while it reloads", () => {
  const source = readFileSync(new URL("../src/integration/unified/useSetDetail.ts", import.meta.url), "utf8");
  assert.match(source, /enabled && id && result\.id === id && result\.set \? \{ set: result\.set, state: "ready" as const, error: "", refreshing: true \}/);
  assert.match(source, /previous\.id === id && previous\.set \? \{ \.\.\.previous, key, error: message, refreshing: true \}/);
  const access = readFileSync(new URL("../src/integration/unified/SetPermissions.tsx", import.meta.url), "utf8");
  assert.match(access, /detail\.state !== "ready" \|\| !!detail\.refreshing/);
  assert.match(access, /\{detail\.error && <p role="alert">Could not refresh access\./);
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(app, /Could not refresh\. Showing the last loaded Set\./);
});
