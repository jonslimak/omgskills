// The static site's footer, shown under Discover: the takeover removes the static page's
// footer, so visitors and rendering crawlers still get these links. Absolute URLs so they
// also work on app.omgskills.com.
const site = "https://omgskills.com";

export const siteFooterColumns = [
  { title: "Library", links: [
    ["Skills", "/skills/"], ["Skills guide", "/guide/"], ["Data", "/data/"],
  ] },
  { title: "Developers", links: [
    ["Developer resources", "/developers/"], ["API spec (OpenAPI)", "/openapi.json"],
    ["Agent guide", "/agents.md"], ["llms.txt", "/llms.txt"],
  ] },
  { title: "Company", links: [
    ["About", "/about/"], ["Support", "/support/"], ["Privacy", "/privacy/"], ["Terms", "/terms/"],
    ["GitHub", "https://github.com/jonslimak/omgskills"],
  ] },
] as const;

export function SiteFooter() {
  return <footer className="ua-site-footer">
    <p>The best and latest agent skills from trusted sources. Open web library, free companion Mac app.</p>
    {siteFooterColumns.map(column => <nav key={column.title} aria-label={column.title}>
      <h2>{column.title}</h2>
      {column.links.map(([label, href]) =>
        <a key={href} href={href.startsWith("/") ? site + href : href} rel={href.startsWith("/") ? undefined : "noreferrer"}>{label}</a>)}
    </nav>)}
  </footer>;
}
