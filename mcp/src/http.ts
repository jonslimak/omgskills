#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Express, Request, Response } from "express";
import { OmgskillsLibrary } from "./library.js";
import { createOmgskillsServer } from "./server.js";

const defaultHost = "127.0.0.1";
const defaultPort = 3000;

export function createOmgskillsHttpApp(library: OmgskillsLibrary): Express {
  const app = createMcpExpressApp({ host: defaultHost });

  app.post("/mcp", async (request, response) => {
    const server = createOmgskillsServer(library);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("Failed to handle local MCP request:", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    } finally {
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    }
  });

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

async function main() {
  const host = process.env.OMGSKILLS_MCP_HOST ?? defaultHost;
  if (host !== defaultHost && host !== "localhost" && host !== "::1") {
    throw new Error("The development HTTP server may only bind to localhost.");
  }

  const port = parsePort(process.env.OMGSKILLS_MCP_PORT);
  const library = await OmgskillsLibrary.load();
  const app = createOmgskillsHttpApp(library);
  app.listen(port, host, () => {
    console.log(`omgskills MCP development server: http://${host}:${port}/mcp`);
  });
}

function methodNotAllowed(_request: Request, response: Response) {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null
  });
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? defaultPort : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid OMGSKILLS_MCP_PORT: ${value ?? ""}`);
  }
  return port;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === entryPath) {
  await main();
}
