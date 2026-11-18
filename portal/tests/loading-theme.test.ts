import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the loading screen paints in the saved theme, so dark mode never flashes white", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /localStorage\.getItem\("omgskills-theme"\)/);
  assert.match(html, /document\.documentElement\.dataset\.uaTheme = theme/);
  const css = readFileSync(new URL("../src/app/loading.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-ua-theme="dark"\] \.portal-loading \{ background: #101012; \}/);
  const pref = readFileSync(new URL("../src/app/unified/theme-preference.ts", import.meta.url), "utf8");
  assert.match(pref, /documentElement\.dataset\.uaTheme = theme/);
});

test("dark mode: pop-ups stand out from the page, and the edit bar's buttons from the bar", () => {
  const css = readFileSync(new URL("../src/app/unified/unified.css", import.meta.url), "utf8");
  assert.match(css, /\.ua-theme\[data-theme="dark"\]:is\(\.ua-drawer, \.ua-detail, \.ua-modal, \.ua-add-sheet\) \{/);
  assert.match(css, /\.ua-overlay\[data-theme="dark"\] \{ background: #000000b3; \}/);
  assert.match(css, /\.ua-theme\[data-theme="dark"\] \.ua-bulk > \.ua-pill:not\(\.ua-primary\) \{ --ua-pill-bg: #34343a;/);
  for (const file of ["../src/app/unified/UnifiedApp.tsx", "../src/integration/unified/SetAddSheet.tsx"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<Dialog\.Overlay className="ua-overlay" data-theme=\{theme\} \/>/);
  }
});
