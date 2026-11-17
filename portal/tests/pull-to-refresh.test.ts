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
  // Sideways swipes are left alone.
  assert.match(source, /Math\.abs\(event\.touches\[0\]\.clientX - startX\) > dy/);
});
