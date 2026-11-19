const catalogPaths = ["/mcp", "/mcp/health", "/data/crawl4/*", "/data/v2/*", "/catalog-skill-urls.json", "/api/public/skill-readme"];

// app.omgskills.com is retired: every address moves to the same place under omgskills.com/app/.
// Public catalog and MCP addresses keep answering in place (200), so old agent setups that POST there still work.
export const appDomainRedirects = [
  ...catalogPaths.flatMap((route) => {
    const target = `https://omgskills.com${route.replace("*", ":splat")}`;
    return ["https", "http"].map((scheme) =>
      `${scheme}://app.omgskills.com${route}  ${target}  200!`
    );
  }),
  // Public profile and Set pages live at the site root, not inside the app.
  "https://app.omgskills.com/u/*    https://omgskills.com/u/:splat     301!",
  "http://app.omgskills.com/u/*     https://omgskills.com/u/:splat     301!",
  "https://app.omgskills.com/app    https://omgskills.com/app/         301!",
  "http://app.omgskills.com/app     https://omgskills.com/app/         301!",
  "https://app.omgskills.com/app/*  https://omgskills.com/app/:splat  301!",
  "http://app.omgskills.com/app/*   https://omgskills.com/app/:splat  301!",
  "https://app.omgskills.com/*      https://omgskills.com/app/:splat  301!",
  "http://app.omgskills.com/*       https://omgskills.com/app/:splat  301!"
];
