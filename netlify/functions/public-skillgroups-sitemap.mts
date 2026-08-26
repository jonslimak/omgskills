import type { Config } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  findIndexablePublicGroups,
  type GroupAccessClient,
} from "./_shared/group-access.js";
import { publicGroupsSitemapXml } from "./_shared/public-group-routes.js";

export async function publicSkillgroupsSitemap(
  client: GroupAccessClient = getPgPool()
): Promise<Response> {
  const groups = await findIndexablePublicGroups(client);
  return new Response(publicGroupsSitemapXml(groups), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}

export default async () => publicSkillgroupsSitemap();

export const config: Config = {
  path: "/sitemap-groups.xml",
};
