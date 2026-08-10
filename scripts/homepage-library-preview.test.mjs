import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  homepageLibraryEndMarker,
  homepageLibraryPaths,
  homepageLibraryProfiles,
  homepageLibraryStartMarker,
  injectHomepageLibraryPreview,
  renderHomepageLibraryCards,
  verifyHomepageLibraryPreview,
} from "./homepage-library-preview.mjs";

function fixtureCollections() {
  return homepageLibraryProfiles.map(({ handle, title }) => ({
    type: "author",
    authorHandle: handle,
    title,
    subtitle: `${title} subtitle`,
    description: `${title} description`,
  }));
}

const homepage = `<div id="library-preview-grid">
${homepageLibraryStartMarker}
${homepageLibraryEndMarker}
</div>`;

test("renders all homepage profiles as static links in the required order", () => {
  const rendered = injectHomepageLibraryPreview(
    homepage,
    renderHomepageLibraryCards(fixtureCollections()),
  );
  assert.deepEqual(verifyHomepageLibraryPreview(rendered), homepageLibraryPaths);
  assert.match(rendered, /<a class="library-profile-card" href="\/library\/anthropics\/">/);
  assert.match(rendered, /Anthropic description/);
});

test("rejects a missing homepage profile", () => {
  assert.throws(
    () => renderHomepageLibraryCards(fixtureCollections().slice(1)),
    /Missing homepage profile data for anthropics/,
  );
});

test("rejects duplicate homepage profile data", () => {
  const collections = fixtureCollections();
  collections.push(collections[0]);
  assert.throws(
    () => renderHomepageLibraryCards(collections),
    /Duplicate homepage profile data for anthropics/,
  );
});

test("does not count links hidden inside JavaScript", () => {
  const runtimeOnly = `<div>${homepageLibraryStartMarker}<script>const card = '<a href="/library/anthropics/">';</script>${homepageLibraryEndMarker}</div>`;
  assert.throws(
    () => verifyHomepageLibraryPreview(runtimeOnly),
    /inside a script/,
  );
});

test("rejects reordered homepage links", () => {
  const cards = renderHomepageLibraryCards(fixtureCollections());
  const reordered = cards.replace(
    'href="/library/anthropics/"',
    'href="/library/openai/"',
  );
  assert.throws(
    () => verifyHomepageLibraryPreview(injectHomepageLibraryPreview(homepage, reordered)),
    /homepage profile 1 was \/library\/openai\//,
  );
});

test("the combined Netlify build refreshes static cards before artifact verification", async () => {
  const source = await readFile(new URL("./build-netlify-site.mjs", import.meta.url), "utf8");
  const copyIndex = source.indexOf("await cp(siteDir, outputDir");
  const refreshIndex = source.indexOf("await refreshHomepageLibraryPreview");
  const verifyIndex = source.indexOf("await verifyWebLibraryDeployArtifacts");
  assert.ok(copyIndex >= 0);
  assert.ok(refreshIndex > copyIndex);
  assert.ok(verifyIndex > refreshIndex);
});
