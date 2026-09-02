import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeviceManifestRoute,
  parsePublicManifestRoute,
  parsePublicPageRoute,
  publicGroupAppDeepLink,
  publicGroupPath,
  publicGroupsSitemapXml,
} from "./public-group-routes.js";

test("recognizes only the exact public manifest route", () => {
  assert.deepEqual(parsePublicManifestRoute("/api/public/groups/Jon/Design/manifest"), {
    handle: "jon",
    groupSlug: "design",
  });
  assert.equal(parsePublicManifestRoute("/api/public/groups/jon/design"), null);
  assert.equal(parsePublicManifestRoute("/api/public/groups/jon/not_ok/manifest"), null);
  assert.equal(parsePublicManifestRoute("/api/public/groups/jon/design/manifest/extra"), null);
});

test("recognizes only the exact device manifest route", () => {
  assert.deepEqual(parseDeviceManifestRoute("/api/device/groups/Jon/Design/manifest"), {
    handle: "jon",
    groupSlug: "design",
  });
  assert.equal(parseDeviceManifestRoute("/api/public/groups/jon/design/manifest"), null);
  assert.equal(parseDeviceManifestRoute("/api/device/groups/jon/not_ok/manifest"), null);
  assert.equal(parseDeviceManifestRoute("/api/device/groups/jon/design/manifest/extra"), null);
});

test("keeps one canonical public group route and recognizes compatibility routes", () => {
  assert.deepEqual(parsePublicPageRoute("/u/jon/sets/design"), {
    kind: "group",
    handle: "jon",
    groupSlug: "design",
    canonicalPath: "/u/jon/sets/design",
  });
  assert.equal(parsePublicPageRoute("/u/Jon/design/")?.canonicalPath, "/u/jon/sets/design");
  assert.equal(
    parsePublicPageRoute("/profiles/jon/sets/design")?.canonicalPath,
    "/u/jon/sets/design"
  );
  assert.equal(publicGroupPath("JON", "Design"), "/u/jon/sets/design");
});

test("rejects malformed public route segments", () => {
  assert.equal(parsePublicPageRoute("/u/jon/sets/not_ok"), null);
  assert.equal(parsePublicPageRoute("/u/jon/sets"), null);
  assert.equal(parsePublicPageRoute("/u/jon/sets/design/extra"), null);
});

test("pins the future app deep-link payload without advertising it", () => {
  assert.equal(
    publicGroupAppDeepLink("jon", "design"),
    "omgskills://group?url=https%3A%2F%2Fomgskills.com%2Fu%2Fjon%2Fsets%2Fdesign"
  );
});

test("renders a deterministic public group sitemap", () => {
  const sitemap = publicGroupsSitemapXml([
    { handle: "zoe", groupSlug: "writing" },
    { handle: "amy", groupSlug: "design" },
  ]);
  assert.ok(sitemap.indexOf("/u/amy/sets/design") < sitemap.indexOf("/u/zoe/sets/writing"));
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
});
