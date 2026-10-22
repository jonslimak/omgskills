import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { catalogInstallMiddleware, catalogInstallServerEnabled, localCatalogLoader } from "./catalog-install-test-server";
import { testBackendOrigin, isIntegrationRequest, isIntegrationBody, connectedInventoryServerEnabled, inventoryReconciliationServerEnabled } from "./integration-config";
import { readmeDev } from "./readme-dev";
import {
  isPublicCatalogRequest,
  publicCatalogPathPattern,
  publicCatalogProxy,
} from "./public-catalog-proxy";

const portalRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const integration = env.VITE_PORTAL_INTEGRATION === "1";
  const backend = integration ? testBackendOrigin(env) : null;
  const catalogProxy = env.PORTAL_PUBLIC_CATALOG_PROXY === "1";
  const connectedInventory = connectedInventoryServerEnabled(command, env);
  const inventoryReconciliation = inventoryReconciliationServerEnabled(command, env);
  // Only the validated connected mode can combine catalog installs and account access.
  const catalogInstall = catalogInstallServerEnabled(command, connectedInventory
    ? { ...env, VITE_PORTAL_INTEGRATION: "0" } : env);
  const pairingBodies = new WeakMap<IncomingMessage, Buffer>();
  return {
    base: "/app/",
    define: {
      "import.meta.env.VITE_PORTAL_INTEGRATION_READY": JSON.stringify(
        Boolean(backend),
      ),
    },
    plugins: [
      react(),
      tailwindcss(),
      readmeDev(catalogProxy),
      {
        name: "local-catalog-install-test",
        configResolved(config) {
          if ((catalogInstall || connectedInventory) && ![undefined, false, "localhost", "127.0.0.1", "[::1]", "::1"].includes(config.server.host)) {
            throw Error("Catalog install test must bind to loopback.");
          }
          if (connectedInventory && config.server.https) throw Error("Connected inventory test requires loopback HTTP.");
        },
        configureServer(server) {
          if (!catalogInstall) return;
          const catalog = catalogInstallMiddleware(localCatalogLoader(path.resolve(portalRoot, "..")));
          server.middlewares.use((req, res, next) => {
            if (connectedInventory && req.url?.startsWith("/api/portal")) return next();
            catalog(req, res, next);
          });
        },
      },
      {
        name: "public-catalog-access",
        configureServer(server) {
          if (!catalogProxy) return;
          server.middlewares.use((req, res, next) => {
            if (!new RegExp(publicCatalogPathPattern).test(req.url || "")) return next();
            if (!isPublicCatalogRequest(req.url || "", req.method)) {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Only public catalog reads are enabled." }));
              return;
            }
            next();
          });
        },
      },
      {
        name: "isolated-portal-access",
        configureServer(server) {
          if (!integration) return;
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith("/api/portal")) return next();
            if (!backend || !isIntegrationRequest(req.url, req.method, connectedInventory, inventoryReconciliation)) {
              res.statusCode = backend ? 405 : 503;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: backend
                    ? "Only approved portal reads, profile saves and basic set changes are enabled."
                    : "Isolated backend is not configured.",
                }),
              );
              return;
            }
            if (connectedInventory && req.url === "/api/portal/sync-pairing-code" && req.method === "POST") {
              const chunks: Buffer[] = [];
              let size = 0;
              const reject = () => {
                if (res.writableEnded) return;
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Invalid pairing approval body." }));
              };
              req.on("error", reject);
              req.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > 8192) reject();
                else chunks.push(chunk);
              });
              req.on("end", () => {
                if (res.writableEnded) return;
                const body = Buffer.concat(chunks);
                try {
                  if (!isIntegrationBody(req.url!, "POST", JSON.parse(body.toString("utf8")), true)) return reject();
                } catch { return reject(); }
                pairingBodies.set(req, body);
                next();
              });
              return;
            }
            next();
          });
        },
      },
    ],
    server: {
      ...(catalogInstall || connectedInventory ? { host: "127.0.0.1" } : {}),
      proxy: {
        ...publicCatalogProxy(catalogProxy),
        ...(backend
          ? {
              "/api/portal": {
                target: backend,
                changeOrigin: true,
                followRedirects: false,
                configure(proxy) {
                  proxy.on("proxyReq", (proxyReq, req) => {
                    const body = pairingBodies.get(req);
                    if (!body) return;
                    proxyReq.setHeader("Content-Length", body.length);
                    proxyReq.removeHeader("Transfer-Encoding");
                    proxyReq.write(body);
                    pairingBodies.delete(req);
                  });
                },
              },
            }
          : {}),
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(portalRoot, "./src"),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
