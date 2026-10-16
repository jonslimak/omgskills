// Frozen before implementing web-v1. IDs and reasons come from the source catalog.
export const acceptanceSource = "f08f73d36e544f5cab145af715fa1f577890aae5076e96052ec7a3b0a669d460";
export const realAcceptance = [
  { query: "appstore skill", id: "safaiyeh/app-store-review-skill", within: 30, reason: "App Store review is the named task, not a generic high-star design tool." },
  { query: "app store", id: "AfeiFun/appstore-connect", within: 30, reason: "App Store spelling variants must find the API skill." },
  { query: "ios design", id: "axiaoge2/Apple-Hig-Designer", within: 100, reason: "Description directly covers Apple iOS design." },
  { query: "ui design", id: "nextlevelbuilder/ui-ux-pro-max-skill:ui-ux-pro-max-skill", within: 100, reason: "UI design is explicitly covered, not merely mentioned in a URL." },
  { query: "browser use", id: "browser-use/browser-use:browser-use", within: 10, reason: "The upstream browser-use skill should be easy to find." },
  { query: "swiftui-pro", id: "twostraws/swiftui-agent-skill:swiftui-pro", within: 10, reason: "Exact skill name from its creator." },
  { query: "@coreyhaines31 ad creative", id: "coreyhaines31/marketingskills:skills/ad-creative", within: 10, reason: "Author-filtered keyword search." },
  { query: "twostraws/swiftui-agent-skill:swiftui-pro", id: "twostraws/swiftui-agent-skill:swiftui-pro", within: 1, reason: "An exact stable ID has direct-lookup intent." },
  { query: "https://github.com/browser-use/browser-use", id: "browser-use/browser-use:browser-use", within: 30, reason: "Repository URLs remain searchable." },
] as const;
export const baselineQueries = ["appstore skill", "ios design", "ui design", "browser use", "swiftui-pro", "APPSTORE", "@anthropics", "\u4e2d\u6587", "", "no-result-73e73b2c"];
export const categoryQueries = ["Design system", "React", "SwiftUI", "Remotion", "App Store", "Landing page", "Brand", "Blog", "SEO", "Scraping", "Social media", "Market research", "Code review", "Security audit", "Playwright", "API design", "Debugging", "Refactoring", "MCP server", "Deck", "Deep research", "PDF", "Humanizer", "Excel"];
