import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  allowedRequest, backendOrigin, database, connectionString, clerkFrontend, verifyDatabase, verifyClerk,
  managementRoute, allowedManagementBody,
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
const writes = process.env.LOCAL_SET_WRITES === "1";
const detailHandler = (await import("../../netlify/functions/portal-group-detail.mjs")).default;
const itemHandler = (await import("../../netlify/functions/portal-group-items.mjs")).default;
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
    res.end(JSON.stringify({ database, readOnly: !writes, mode: writes ? "set-management" : "read-only", clerkFrontend: frontend })); return;
  }
  if (!allowedRequest(req.url, req.method, req.headers, writes)) {
    res.writeHead(405); res.end(JSON.stringify({ error: "This operation is not enabled in the isolated test backend." })); return;
  }
  try {
    const headers = new Headers();
    // Only forward authentication, not ambient host/proxy/production headers.
    if (req.headers.authorization) headers.set("authorization", req.headers.authorization);
    let body: string | undefined;
    const route = managementRoute(req.url, req.method);
    if (req.method !== "GET") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { res.writeHead(413); res.end(JSON.stringify({ error: "Request too large." })); return; }
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString("utf8");
      let value;
      try { value = JSON.parse(body); } catch { value = null; }
      if (!allowedManagementBody(req.url, req.method, value)) {
        res.writeHead(400); res.end(JSON.stringify({ error: "Only private set creation, renaming and single-skill membership changes are enabled." })); return;
      }
      await verifyDatabase(pool);
      if (route !== "groups") {
        const path = req.url!.replace(/\/items$/, "");
        const access = await detailHandler(new Request(`${backendOrigin}${path}`, { headers }), {} as never);
        if (!access.ok) { res.writeHead(access.status); res.end(await access.text()); return; }
        const { group: set, accessRole } = await access.json();
        if (accessRole !== "owner") { res.writeHead(403); res.end(JSON.stringify({ error: "Only the owner can edit this set." })); return; }
        if (set.disabledAt || (set.visibility !== "private" && !(set.isFavorites && route === "items"))) {
          res.writeHead(409); res.end(JSON.stringify({ error: "Shared set editing is not enabled in this test." })); return;
        }
      }
      headers.set("content-type", "application/json");
    }
    const handler = route === "detail" ? detailHandler : route === "items" ? itemHandler : handlers.get(req.url!);
    const response = await handler!(new Request(`${backendOrigin}${req.url}`, { headers, method: req.method, body }), {} as never);
    res.writeHead(response.status);
    res.end(await response.text());
  } catch {
    res.writeHead(500); res.end(JSON.stringify({ error: "Local account request failed." }));
  }
});
server.requestTimeout = 15000;
server.listen(8890, "127.0.0.1", () => console.log(`${writes ? "Set-management" : "Read-only"} test backend: ${backendOrigin}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
});
