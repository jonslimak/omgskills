import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("app and local review use the homepage eyes favicon", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  assert.equal(read("../src/assets/favicon.svg"), read("../../site/favicon.svg"));
  for (const entry of ["../index.html", "../testing/unified-acceptance/index.html"]) {
    assert.match(read(entry), /<link rel="icon" href="\/src\/assets\/favicon\.svg" type="image\/svg\+xml" \/>/);
    assert.doesNotMatch(read(entry), /href="data:,"/);
  }
});
