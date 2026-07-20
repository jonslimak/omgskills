const noindexMeta = '<meta name="robots" content="noindex,follow">';

export function isNoindexPage(html) {
  return String(html).includes(noindexMeta);
}

export function assertIndexStateMatchesSitemap({ html, sitemap, canonical, label }) {
  const sitemapEntry = `<loc>${canonical}</loc>`;
  const isListed = String(sitemap).includes(sitemapEntry);
  const shouldBeListed = !isNoindexPage(html);

  if (isListed !== shouldBeListed) {
    const expected = shouldBeListed ? "included in" : "excluded from";
    throw new Error(`${label} expected ${canonical} to be ${expected} the sitemap`);
  }
}
