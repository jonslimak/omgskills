import type { Config, Context } from "@netlify/functions";

export default async (_req: Request, _context: Context) => {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
};

export const config: Config = {
  path: ["/u/:handle", "/u/:handle/:groupSlug"],
  preferStatic: true
};
