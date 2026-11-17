import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PULL_MAX, PULL_REFRESH, pullDistance } from "../src/app/unified/PullToRefresh";

test("a pull follows the finger at half speed, up to a limit", () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(40), 20);
  assert.ok(pullDistance(PULL_REFRESH * 2) >= PULL_REFRESH);
  assert.equal(pullDistance(1000), PULL_MAX);
});

test("phones get pull to refresh on the main pane, which reloads the page", () => {
  const app = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<PullToRefresh scroller=\{main\} enabled=\{phone && !picked\.length && !management\?\.busy\} \/>/);
  const source = readFileSync(new URL("../src/app/unified/PullToRefresh.tsx", import.meta.url), "utf8");
  assert.match(source, /onRefresh = \(\) => window\.location\.reload\(\)/);
  // Only starts at the top of the page.
  assert.match(source, /element\.scrollTop <= 0/);
  // The spinner stays under the search bar, not on the stretching page.
  assert.match(source, /setTop\(element\.getBoundingClientRect\(\)\.top\)/);
  // The page moves down to make room for the spinner, and stays down while refreshing.
  assert.match(source, /element\.style\.setProperty\("--ua-ptr", `\$\{Math\.min\(PULL_GAP, shown\)\}px`\)/);
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(css, /\.ua-main\[data-ptr\] > \.ua-content \{\s*transform: translateY\(var\(--ua-ptr, 0px\)\)/);
  // The A–Z rail keeps its drag; a gesture the browser already took is left to it.
  assert.match(source, /closest\("\.ua-az-anchor"\)/);
  assert.match(source, /if \(!event\.cancelable\) \{ startY = null; return; \}/);
  // Sideways swipes are left to the page: decided once, before anything is blocked.
  assert.match(source, /if \(!pulling\) \{/);
  assert.match(source, /if \(dy <= 0 \|\| dx > dy \|\| element\.scrollTop > 0\) \{ startY = null; return; \}/);
});
