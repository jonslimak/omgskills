import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { catalogInstallMiddleware, catalogInstallServerEnabled, localCatalogLoader } from "./catalog-install-test-server";
import { testBackendOrigin, isIntegrationRequest } from "./integration-config";
import {
  isPublicCatalogRequest,
  publicCatalogPathPattern,
  publicCatalogProxy,
} from "./public-catalog-proxy";

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const integration = env.VITE_PORTAL_INTEGRATION === "1";
  const backend = integration ? testBackendOrigin(env) : null;
  const catalogProxy = env.PORTAL_PUBLIC_CATALOG_PROXY === "1";
  const catalogInstall = catalogInstallServerEnabled(command, env);
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
      {
        name: "local-catalog-install-test",
        configResolved(config) {
          if (catalogInstall && ![undefined, false, "localhost", "127.0.0.1"].includes(config.server.host)) {
            throw Error("Catalog install test must bind to loopback.");
          }
        },
        configureServer(server) {
          if (!catalogInstall) return;
          server.middlewares.use(catalogInstallMiddleware(localCatalogLoader(path.resolve(__dirname, ".."))));
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
            if (!backend || !isIntegrationRequest(req.url, req.method)) {
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
            next();
          });
        },
      },
    ],
    server: {
      ...(catalogInstall ? { host: "127.0.0.1" } : {}),
      proxy: {
        ...publicCatalogProxy(catalogProxy),
        ...(backend
          ? {
              "/api/portal": {
                target: backend,
                changeOrigin: true,
                followRedirects: false,
              },
            }
          : {}),
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
