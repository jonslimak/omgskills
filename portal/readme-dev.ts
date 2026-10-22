import type { Plugin } from "vite";
import { createSkillReadmeHandler } from "../netlify/functions/_shared/skill-readme";

export function readmeDev(enabled: boolean): Plugin {
  const handler = createSkillReadmeHandler();
  return {
    name: "local-public-readme",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname !== "/api/public/skill-readme") return next();
        // Only the public ID and method enter the handler; account headers never do.
        void handler(new Request(url, { method: req.method })).then(async response => {
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(await response.text());
        }).catch(() => {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Local README reader unavailable." }));
        });
      });
    },
  };
}
