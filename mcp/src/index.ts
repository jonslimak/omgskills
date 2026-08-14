#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OmgskillsLibrary } from "./library.js";
import { createOmgskillsServer } from "./server.js";

const library = await OmgskillsLibrary.load();
const server = createOmgskillsServer(library);

await server.connect(new StdioServerTransport());
