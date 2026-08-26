import assert from "node:assert/strict";
import test from "node:test";
import type { GroupAccessClient } from "./group-access.js";
import { publicSkillgroupsSitemap } from "../public-skillgroups-sitemap.mjs";

test("emits the public groups selected by the shared access policy", async () => {
  const client: GroupAccessClient = {
    async query() {
      return {
        rows: [{ handle: "jon", groupSlug: "design" }],
        rowCount: 1,
      } as any;
    },
  };
  const response = await publicSkillgroupsSitemap(client);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.match(await response.text(), /https:\/\/omgskills\.com\/u\/jon\/sets\/design/);
});
