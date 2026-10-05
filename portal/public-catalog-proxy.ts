import type { ProxyOptions } from "vite";

export const publicCatalogPathPattern = "^/(?:mcp(?:/health)?|data/(?:crawl4|v2)/[^?]+|catalog-skill-urls\\.json)(?:\\?.*)?$";

export function isPublicCatalogRequest(url: string, method = "GET") {
  if (!new RegExp(publicCatalogPathPattern).test(url)) return false;
  const pathname = url.split("?")[0];
  if (pathname.includes("%") || pathname.includes("\\") || pathname.split("/").some((part) => part === "." || part === "..")) return false;
  return pathname === "/mcp"
    ? method === "POST"
    : method === "GET" || method === "HEAD";
}

export function publicCatalogProxy(enabled: boolean): Record<string, ProxyOptions> {
  if (!enabled) return {};
  return {
    [publicCatalogPathPattern]: {
      target: "https://omgskills.com",
      changeOrigin: true,
      followRedirects: false,
      timeout: 20_000,
      proxyTimeout: 20_000,
      configure(proxy) {
        proxy.on("proxyReq", (request) => {
          request.removeHeader("authorization");
          request.removeHeader("cookie");
        });
      },
    },
  };
}
