import type { CatalogDisplay, Navigation } from "./model";

// Document title and head metadata for the app (urls.md step 2, item 4).
const viewTitles: Partial<Record<Navigation["view"], string>> = {
  all: "My skills", favorites: "Favorites", sets: "Sets", discover: "Discover", data: "Data", developers: "Developers & Agents",
  top: "Trending skills", collections: "Collections", agents: "Agents", devices: "Devices",
  profile: "Profile", github: "GitHub sources", mcp: "MCP server",
};

export function pageTitle(nav: Navigation, catalog: Pick<CatalogDisplay, "skills" | "creators" | "collections">) {
  const skillId = nav.selected.startsWith("catalog:") ? nav.selected.slice(8) : "";
  const name = skillId && catalog.skills.find(skill => skill.id === skillId)?.name
    || (nav.query ? `“${nav.query.trim()}”` : "")
    || (nav.view === "creator" ? catalog.creators.find(item => item.handle === nav.id)?.name || nav.id : "")
    || (nav.view === "collection" ? catalog.collections.find(item => item.id === nav.id)?.name || "Collection" : "")
    || (nav.view === "creators" ? (nav.id === "companies" ? "Companies" : "Creators") : "")
    || viewTitles[nav.view] || "";
  return name ? `${name} | omgskills` : "omgskills";
}

// Search-engine and sharing tags that describe one static page. On a taken-over page they
// stay while it shows its own view, and are removed (and restored on Back) otherwise.
const pageMetaSelector = 'link[rel="canonical"], link[rel="alternate"], meta[name="description"], '
  + 'meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]';

export function createPageMetadata(doc: Document, takeover: boolean) {
  const initialAddress = doc.location.pathname + doc.location.search;
  const initialTitle = doc.title;
  const pageMeta = takeover ? [...doc.head.querySelectorAll(pageMetaSelector)] : [];
  let robots: HTMLMetaElement | null = null;
  return (address: string, title: string) => {
    const own = takeover && address === initialAddress;
    doc.title = own ? initialTitle : title;
    if (!takeover) return;
    for (const element of pageMeta) {
      if (own && !element.isConnected) doc.head.append(element);
      if (!own && element.isConnected) element.remove();
    }
    // Other views are app pages, which stay out of search results like /app itself.
    if (own) robots?.remove();
    else if (!robots?.isConnected) {
      robots ??= Object.assign(doc.createElement("meta"), { name: "robots", content: "noindex, follow" });
      doc.head.append(robots);
    }
  };
}
