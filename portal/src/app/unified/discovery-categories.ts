import type { CatalogDisplay } from "./model";

// Mac Discover starter searches, in visual row order for the two-column grid.
export const discoveryCategories: CatalogDisplay["categories"] = [
  { label: "Design + Apps", items: ["Design system", "React", "SwiftUI", "Remotion", "App Store", "Landing page"] },
  { label: "Marketing", items: ["Brand", "Blog", "SEO", "Scraping", "Social media", "Market research"] },
  { label: "Coding", items: ["Code review", "Security audit", "Playwright", "API design", "Debugging", "Refactoring"] },
  { label: "Practical", items: ["MCP server", "Deck", "Deep research", "PDF", "Humanizer", "Excel"] },
];
