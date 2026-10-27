#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultLibraryPaths, OmgskillsLibrary } from "./library.js";
import { createOmgskillsServer } from "./server.js";

const library = await OmgskillsLibrary.load({ ...defaultLibraryPaths(), ranking: true });
const server = createOmgskillsServer(library, { paging: true, ranking: true });

await server.connect(new StdioServerTransport());
