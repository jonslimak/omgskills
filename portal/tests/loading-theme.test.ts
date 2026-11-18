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
