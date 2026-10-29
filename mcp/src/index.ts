#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRefreshingCatalog } from "./catalog-refresh.js";
import { createOmgskillsServer } from "./server.js";

const catalog = await createRefreshingCatalog();
const server = createOmgskillsServer(catalog.get, { paging: true, ranking: true });
server.server.onclose = catalog.stop;
process.stdin.once("end", () => { catalog.stop(); void server.close(); });

try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  catalog.stop();
  throw error;
}
