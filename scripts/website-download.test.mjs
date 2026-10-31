import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultDownloadURL } from "./verify-production-deploy.mjs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("both website download routes pin the published companion, without rewriting the legacy DMG", () => {
  const redirects = read("site/_redirects").split(/\r?\n/).filter(line => /^\/download(?:\s|\/\s)/.test(line));
  assert.deepEqual(redirects, [`/download ${defaultDownloadURL} 302`, `/download/ ${defaultDownloadURL} 302`]);
  assert.match(defaultDownloadURL, /connected-v0\.0\.29\/OMGSkills-Connected-0\.0\.29-29-arm64\.zip$/);
  assert.ok(read("portal/src/app/unified/production-distribution.ts").includes(`url: "${defaultDownloadURL}"`));
  assert.doesNotMatch(read("site/_redirects"), /^\/downloads\/omgskills-mac\.dmg\s/m);
  assert.ok(read("scripts/check-product-health.mjs").includes(`const defaultDownloadURL = "${defaultDownloadURL}"`));
  assert.ok(read("scripts/check-product-health.mjs").includes("redirect.status === 302 && location === defaultDownloadURL"));
});

test("primary links show Mac requirements and retain an explicit original-app option", () => {
  for (const file of ["site/guide/index.html", "site/support/index.html", "site/about/index.html", "scripts/build-web-library.mjs"]) {
    const source = read(file);
    assert.match(source, /(?:href="\/download"|\$\{origin\}\/download)/, file);
    assert.match(source, /Apple silicon, macOS 14\+/, file);
    assert.match(source, /[Oo]riginal Mac app/, file);
    assert.match(source, /\/downloads\/omgskills-mac\.dmg/, file);
  }
  const structured = [...read("site/index.html").matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .flatMap(match => { const value = JSON.parse(match[1]); return value["@graph"] ?? [value]; });
  const app = structured.find(item => item["@type"] === "SoftwareApplication");
  assert.equal(app.downloadUrl, "https://omgskills.com/download");
  assert.equal(app.operatingSystem, "macOS 14 or later");
  assert.equal(app.softwareRequirements, "Apple silicon Mac");
});

test("existing download reports count the promoted URL as well as historical DMG clicks", () => {
  assert.match(read("scripts/check-funnel-health.mjs"), /secondary === "\/downloads\/omgskills-mac\.dmg" \|\| secondary === "\/download"/);
  assert.match(read("scripts/funnel-report-csv.mjs"), /click\.secondary === "\/downloads\/omgskills-mac\.dmg" \|\| click\.secondary === "\/download"/);
});
