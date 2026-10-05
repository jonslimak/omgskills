import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { testBackendOrigin, isIntegrationRequest } from "./integration-config";
import {
  isPublicCatalogRequest,
  publicCatalogPathPattern,
  publicCatalogProxy,
} from "./public-catalog-proxy";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const integration = env.VITE_PORTAL_INTEGRATION === "1";
  const backend = integration ? testBackendOrigin(env) : null;
  const catalogProxy = env.PORTAL_PUBLIC_CATALOG_PROXY === "1";
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
