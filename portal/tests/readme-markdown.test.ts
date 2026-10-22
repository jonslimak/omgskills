import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReadmeMarkdown, { readmeLink } from "../src/app/unified/ReadmeMarkdown";

const sourceUrl = "https://github.com/owner/repo/blob/develop/README.md";
const render = (markdown: string) => renderToStaticMarkup(createElement(ReadmeMarkdown, { markdown, sourceUrl }));

test("README rendering supports headings, lists, code and GitHub tables", () => {
  const html = render("# README\n\nParagraph.\n\n- Item\n\n```sh\nnpm test\n```\n\n| Name | Value |\n| --- | --- |\n| A | B |");
  for (const tag of ["<h1>", "<p>", "<ul>", "<pre>", "<table>"]) assert.ok(html.includes(tag), tag);
  assert.match(html, /ua-readme-table/);
});

test("remote HTML, scripts, iframes, images and unsafe protocols are not rendered", () => {
  const html = render('<script>alert("secret")</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<img src="https://evil.test/pixel">\n\n![badge](https://evil.test/badge)\n\n[unsafe](javascript:alert%281%29)\n\n[encoded](data:text/html,evil)');
  assert.doesNotMatch(html, /<script|<iframe|<img|javascript:|data:text|evil\.test/);
});

test("relative documentation links resolve against the README source and open safely", () => {
  const html = render("[Docs](docs/setup.md)\n\n[Site](https://example.test)");
  assert.match(html, /https:\/\/github\.com\/owner\/repo\/blob\/develop\/docs\/setup\.md/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  for (const url of ["javascript:alert(1)", "data:text/html,evil", "file:///etc/passwd", "https://user:pass@example.test"]) assert.equal(readmeLink(url, sourceUrl), "");
});
