import type { Config, Context } from "@netlify/functions";
import { recordAnalytics } from "./_shared/group-items.js";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const itemId = url.searchParams.get("itemId");
  if (!target || !itemId) {
    return new Response("Not found", { status: 404 });
  }
  let redirect: URL;
  try {
    redirect = new URL(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (redirect.protocol !== "https:" || redirect.hostname !== "github.com") {
    return new Response("Not found", { status: 404 });
  }

  await recordAnalytics("skill_open", { skillItemId: itemId });
  return Response.redirect(redirect, 302);
};

export const config: Config = {
  path: "/api/public/skill-open"
};
