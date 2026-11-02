import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootWriterPaths = [
  ".github/workflows/scrape.yml",
  ".github/workflows/x-refresh.yml",
];

async function workflow(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function position(text, value, path) {
  const index = text.indexOf(value);
  assert.notEqual(index, -1, `${path} is missing ${value}`);
  return index;
}

for (const path of rootWriterPaths) {
  test(`${path} gates root publication before commit and deploy`, async () => {
    const text = await workflow(path);
    const baseline = position(text, "publication:impact -- snapshot --track root", path);
    const publish = position(text, "./scripts/publish-data.sh", path);
    const check = position(text, "publication:impact -- check --track root", path);
    const commit = position(text, "- name: Commit if changed", path);
    const deploy = position(text, "- name: Deploy site to Netlify", path);
    const upload = position(text, "- name: Upload publication impact", path);

    assert.ok(baseline < publish, `${path} must capture its baseline before publishing`);
    assert.ok(publish < check, `${path} must check the proposed publication`);
    assert.ok(check < commit, `${path} must block before commit`);
    assert.ok(check < deploy, `${path} must block before deploy`);
    assert.ok(check < upload && upload < commit, `${path} must upload reports before commit`);
    assert.match(
      text.slice(upload, commit),
      /if: always\(\)[\s\S]*?if-no-files-found: error/,
      `${path} must upload impact reports even after a blocked check`,
    );
    assert.match(text, /publication_impact_override:\n[\s\S]*?default: false\n[\s\S]*?type: boolean/);
    assert.match(text, /PUBLICATION_IMPACT_OVERRIDE: \$\{\{ inputs\.publication_impact_override == true && '1' \|\| '' \}\}/);
    assert.match(text, /PUBLICATION_IMPACT_OVERRIDE_REASON: \$\{\{ inputs\.publication_impact_override_reason \|\| '' \}\}/);
  });
}

test("content reports refresh only v2 overlays and gate that same track", async () => {
  const path = ".github/workflows/content-reports.yml";
  const text = await workflow(path);
  const restore = position(text, "data-store.mjs pull --dir site/data/v2", path);
  const baseline = position(text, "publication:impact -- snapshot --track v2", path);
  const publish = position(text, "node ./scripts/publish-content-data.mjs", path);
  const verify = position(text, "OMGSKILLS_DATA_SUBDIR=v2 node ./scripts/verify-published-data.mjs", path);
  const check = position(text, "publication:impact -- check --track v2", path);
  const upload = position(text, "- name: Upload publication impact", path);
  const store = position(text, "data-store.mjs push --dir site/data/v2", path);
  const commit = position(text, "- name: Commit if changed", path);
  const deploy = position(text, "- name: Deploy site to Netlify", path);
  assert.ok(restore < baseline && baseline < publish && publish < verify && verify < check);
  assert.ok(check < upload && upload < store && store < commit && commit < deploy);
  assert.match(text.slice(upload, store), /if: always\(\)[\s\S]*?if-no-files-found: error/);
  assert.match(text, /publication-impact-v2\.json/);
  assert.match(text, /publication-impact\.v2\.(?:json|md)/);
  assert.doesNotMatch(text, /--track root|publication-impact[.-]root|publish-data\.sh/);
  assert.match(text, /git add -A -- site\/data\/v2(?:\n|$)/);
  assert.doesNotMatch(text, /git add -A -- site\/data(?:\s|$)/);
  assert.match(text, /PUBLICATION_IMPACT_OVERRIDE: \$\{\{ inputs\.publication_impact_override == true && '1' \|\| '' \}\}/);
  assert.match(text, /PUBLICATION_IMPACT_OVERRIDE_REASON: \$\{\{ inputs\.publication_impact_override_reason \|\| '' \}\}/);
  for (const name of ["Restore v2 publication assets", "Upload v2 report assets to R2", "Prepare release assets for Netlify deploy"]) {
    const start = position(text, `      - name: ${name}`, path);
    const end = text.indexOf("\n      - name:", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    for (const secret of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      assert.ok(step.includes(`${secret}: \${{ secrets.${secret} }}`), `${name} must receive ${secret}`);
    }
    assert.doesNotMatch(step, /continue-on-error:/);
  }
});

test("combined publisher gates both app-data tracks before commit and deploy", async () => {
  const path = ".github/workflows/shadow-crawl-health.yml";
  const text = await workflow(path);
  const writerJob = text.slice(position(text, "  shadow-crawl-health:", path));
  const baselineV2 = position(writerJob, "publication:impact -- snapshot --track v2", path);
  const baselineCrawl4 = position(writerJob, "publication:impact -- snapshot --track crawl4", path);
  const publishV2 = position(writerJob, "OMGSKILLS_DATA_SUBDIR=v2 ./scripts/publish-data.sh", path);
  const publishCrawl4 = position(writerJob, "node ./scripts/publish-crawl4-data.mjs", path);
  const checkV2 = position(writerJob, "publication:impact -- check --track v2", path);
  const checkCrawl4 = position(writerJob, "publication:impact -- check --track crawl4", path);
  const commit = position(writerJob, "- name: Commit if changed", path);
  const deploy = position(writerJob, "- name: Deploy site to Netlify", path);
  const upload = position(writerJob, "- name: Upload publication impact", path);

  assert.ok(baselineV2 < publishV2 && baselineCrawl4 < publishCrawl4);
  assert.ok(publishV2 < checkV2 && publishCrawl4 < checkCrawl4);
  assert.ok(checkV2 < commit && checkCrawl4 < commit);
  assert.ok(checkV2 < deploy && checkCrawl4 < deploy);
  assert.match(writerJob.slice(upload, commit), /if: always\(\)[\s\S]*?if-no-files-found: error/);
  assert.match(text, /publication_impact_override:\n[\s\S]*?default: false\n[\s\S]*?type: boolean/);
  assert.match(writerJob, /PUBLICATION_IMPACT_OVERRIDE: \$\{\{ inputs\.publication_impact_override == true && '1' \|\| '' \}\}/);
});
