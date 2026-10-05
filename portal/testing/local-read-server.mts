import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  allowedRequest, backendOrigin, database, connectionString, clerkFrontend, verifyDatabase, verifyClerk,
} from "./local-environment.mjs";

assert.equal(process.env.CONTEXT, "dev");
assert.equal(process.env.SKILLGROUPS_DATABASE_URL, connectionString());
assert.ok(!Object.keys(process.env).some(key => /^(NETLIFY|NEON|DATABASE_URL|PG|OMGSKILLS_GITHUB_BROKER)/.test(key)), "Unexpected backend credentials");
const publicKey = process.env.VITE_CLERK_PUBLISHABLE_KEY!;
const secretKey = process.env.CLERK_SECRET_KEY!;
const frontend = clerkFrontend(publicKey);
assert.match(secretKey || "", /^sk_test_[A-Za-z0-9]+$/);
await verifyClerk({ publicKey, secretKey, frontend });
const { getPgPool } = await import("../../netlify/functions/_shared/db.js");
const pool = getPgPool();
await verifyDatabase(pool);
const handlers = new Map([
  ["/api/portal/synced-skills", (await import("../../netlify/functions/portal-synced-skills.mjs")).default],
  ["/api/portal/groups", (await import("../../netlify/functions/portal-groups.mjs")).default],
  ["/api/portal/shared", (await import("../../netlify/functions/portal-shared.mjs")).default],
  ["/api/portal/profile", (await import("../../netlify/functions/portal-profile.mjs")).default],
]);
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health" && req.method === "GET" && req.headers.host === new URL(backendOrigin).host) {
    res.end(JSON.stringify({ database, readOnly: true, clerkFrontend: frontend })); return;
  }
  if (!allowedRequest(req.url, req.method, req.headers)) {
    res.writeHead(405); res.end(JSON.stringify({ error: "Only approved local account reads are enabled." })); return;
  }
  try {
    const headers = new Headers();
    // Only forward authentication, not ambient host/proxy/production headers.
    if (req.headers.authorization) headers.set("authorization", req.headers.authorization);
    const response = await handlers.get(req.url!)!(new Request(`${backendOrigin}${req.url}`, { headers }), {} as never);
    res.writeHead(response.status);
    res.end(await response.text());
  } catch {
    res.writeHead(500); res.end(JSON.stringify({ error: "Local account read failed." }));
  }
});
server.requestTimeout = 15000;
server.listen(8890, "127.0.0.1", () => console.log(`Read-only test backend: ${backendOrigin}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
});
