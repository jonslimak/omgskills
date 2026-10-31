import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppErrorBoundary } from "../src/app/unified/AppErrorBoundary";

test("the app renders normally until an error, then offers Reload and help", () => {
  const boundary = new AppErrorBoundary({ children: createElement("p", null, "app") });
  assert.equal(renderToStaticMarkup(boundary.render() as never), "<p>app</p>");
  boundary.state = AppErrorBoundary.getDerivedStateFromError();
  const html = renderToStaticMarkup(boundary.render() as never);
  assert.match(html, /role="alert"/);
  assert.match(html, /Something went wrong/);
  assert.match(html, /<button type="button">Reload<\/button>/);
  assert.match(html, /href="\/support\/"/);
});
