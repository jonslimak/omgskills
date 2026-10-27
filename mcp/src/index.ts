#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDefaultCatalog } from "./catalog-tracks.js";
import { createOmgskillsServer } from "./server.js";

const library = await loadDefaultCatalog();
const server = createOmgskillsServer(library, { paging: true, ranking: true });

await server.connect(new StdioServerTransport());
