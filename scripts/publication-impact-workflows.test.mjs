import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootWriterPaths = [
  ".github/workflows/scrape.yml",
  ".github/workflows/content-reports.yml",
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
