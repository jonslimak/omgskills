import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { GroupAccessClient } from "./group-access.js";
import type { GroupManifestView } from "./group-manifest-adapters.js";
import {
  publicSkillgroupPage,
  type PublicSkillgroupPageDependencies,
} from "../public-skillgroup-page.mjs";

const context = {
  deploy: { context: "production" },
  params: {},
} as Context;

function result(rows: any[]) {
  return { rows, rowCount: rows.length } as any;
}

function sequenceClient(rowsByQuery: any[][]): GroupAccessClient {
  let index = 0;
  return {
    async query() {
      const rows = rowsByQuery[index++];
      assert.notEqual(rows, undefined, `unexpected query ${index}`);
      return result(rows);
    },
  };
}

function manifestView(): GroupManifestView {
  return {
    manifest: {
      type: "omgskills.skill_group",
      version: 2,
      group: {
        id: "group-id",
        name: "Design tools",
        description: "A focused set of design skills.",
        slug: "design-tools",
        revision: 4,
      },
      items: [{
        id: "item-id",
        kind: "catalog",
        position: 0,
        name: "Design skill",
        description: "Design useful interfaces.",
        note: null,
        installability: { status: "metadata_only", reason: "release_unavailable" },
      }],
    },
    linkHints: new Map([[
      "item-id",
      { catalogSkillId: "owner/repo:design", githubUrl: null, isLocalOnly: false },
    ]]),
  };
}

function dependencies(
  rowsByQuery: any[][],
  loadPublicGroupManifest: PublicSkillgroupPageDependencies["loadPublicGroupManifest"] = async () => manifestView()
): PublicSkillgroupPageDependencies {
  return {
    pool: sequenceClient(rowsByQuery),
    loadPublicGroupManifest,
    async loadCatalogSkillUrls() {
      return new Map([["owner/repo:design", "/skills/owner/repo/design/"]]);
    },
    async recordAnalytics() {},
  };
}

const publishedUser = {
  id: "user-id",
  handle: "jon",
  displayName: "Jon",
  profilePublished: true,
};

test("renders a public group with canonical metadata and no premature install action", async () => {
  const response = await publicSkillgroupPage(
    new Request("https://omgskills.com/u/jon/sets/design-tools"),
    context,
    dependencies([[publishedUser]])
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /^public/);
  assert.match(body, /<title>Design tools by Jon \| omgskills<\/title>/);
  assert.match(body, /<link rel="canonical" href="https:\/\/omgskills\.com\/u\/jon\/sets\/design-tools">/);
  assert.match(body, /<meta property="og:title"/);
  assert.doesNotMatch(body, /noindex/);
  assert.doesNotMatch(body, /omgskills:\/\/group|Install (all|group)|Open in omgskills/i);
});

test("redirects compatibility and trailing-slash routes to the canonical group URL", async () => {
  for (const path of [
    "/u/jon/design-tools",
    "/profiles/jon/sets/design-tools",
    "/u/jon/sets/design-tools/",
  ]) {
    const response = await publicSkillgroupPage(
      new Request(`https://omgskills.com${path}`),
      context,
      dependencies([])
    );
    assert.equal(response.status, 301);
    assert.equal(
      response.headers.get("location"),
      "https://omgskills.com/u/jon/sets/design-tools"
    );
  }
});

test("hides private, restricted, disabled, and unpublished-profile groups", async (t) => {
  for (const label of ["private", "restricted", "disabled"] as const) {
    await t.test(label, async () => {
      const response = await publicSkillgroupPage(
        new Request("https://omgskills.com/u/jon/sets/design-tools"),
        context,
        dependencies([[publishedUser]], async () => {
          throw new Response("Group not found", { status: 404 });
        })
      );
      const body = await response.text();
      assert.equal(response.status, 404);
      assert.match(body, /Not found/);
      assert.doesNotMatch(body, /Design tools/);
      assert.match(body, /noindex,follow/);
    });
  }

  await t.test("unpublished profile", async () => {
    const response = await publicSkillgroupPage(
      new Request("https://omgskills.com/u/jon/sets/design-tools"),
      context,
      dependencies([[{ ...publishedUser, profilePublished: false }]])
    );
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /profile is private/i);
  });
});

test("keeps a private profile generic and out of search", async () => {
  const response = await publicSkillgroupPage(
    new Request("https://omgskills.com/u/jon"),
    context,
    dependencies([[{ ...publishedUser, profilePublished: false }]])
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /This profile is private/);
  assert.match(body, /noindex,follow/);
});
