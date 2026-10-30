import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMcpEndpoint } from "../../scripts/verify-mcp-endpoint.mjs";
import { createOmgskillsHttpApp } from "../src/http.js";
import { OmgskillsLibrary } from "../src/library.js";

test("the unchanged release verifier accepts the nine-tool contract over local HTTP", async context => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  const skills = fixture("skills");
  const app = createOmgskillsHttpApp(OmgskillsLibrary.fromData({ skills, trending: fixture("trending"), goldBasket: fixture("gold-basket") }));
  app.get("/mcp/health", (_request, response) => response.json({ ok: true, skillCount: skills.length }));
  const listener = app.listen(0, "127.0.0.1");
  context.after(() => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  await verifyMcpEndpoint({ origin: `http://127.0.0.1:${address.port}`, requireCatalogSearch: false });
});
