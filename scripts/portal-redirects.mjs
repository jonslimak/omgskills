const catalogPaths = ["/mcp", "/mcp/health", "/data/crawl4/*", "/data/v2/*", "/catalog-skill-urls.json"];

// Public catalog exceptions must precede the app subdomain's forced SPA fallback.
export const appDomainRedirects = [
  ...catalogPaths.flatMap((route) => {
    const target = `https://omgskills.com${route.replace("*", ":splat")}`;
    return ["https", "http"].map((scheme) =>
      `${scheme}://app.omgskills.com${route}  ${target}  200!`
    );
  }),
  "https://app.omgskills.com/app/assets/*  /app/assets/:splat  200!",
  "http://app.omgskills.com/app/assets/*   /app/assets/:splat  200!",
  "https://app.omgskills.com/assets/*      /app/assets/:splat  200!",
  "http://app.omgskills.com/assets/*       /app/assets/:splat  200!",
  "https://app.omgskills.com/*             /app/index.html     200!",
  "http://app.omgskills.com/*              /app/index.html     200!"
];
