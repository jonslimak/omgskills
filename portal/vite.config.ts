import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { testBackendOrigin, isIntegrationRead } from "./integration-config";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const integration = env.VITE_PORTAL_INTEGRATION === "1";
  const backend = integration ? testBackendOrigin(env) : null;
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
        name: "isolated-portal-reads",
        configureServer(server) {
          if (!integration) return;
          server.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith("/api/portal")) return next();
            if (!backend || !isIntegrationRead(req.url, req.method)) {
              res.statusCode = backend ? 405 : 503;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: backend
                    ? "Only approved portal reads are enabled."
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
      proxy: backend
        ? {
            "/api/portal": {
              target: backend,
              changeOrigin: true,
              followRedirects: false,
            },
          }
        : undefined,
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
