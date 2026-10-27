import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "../src/app/unified/SiteFooter";

test("Discover's footer keeps the static homepage footer's links", () => {
  const homepage = readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
  const staticFooter = homepage.slice(homepage.indexOf("<footer"), homepage.indexOf("</footer>"));
  const staticLinks = [...staticFooter.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, href, label]) => [label, href.startsWith("/") ? `https://omgskills.com${href}` : href])
    .filter(([label]) => label !== "Discover");
  const markup = renderToStaticMarkup(createElement(SiteFooter));
  const appLinks = [...markup.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, href, label]) => [label, href]);
  assert.deepEqual(appLinks, staticLinks);
});
