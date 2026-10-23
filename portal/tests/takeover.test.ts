import test from "node:test";
import assert from "node:assert/strict";
import { announceAppReady, startTakeover } from "../src/takeover";

function page({ withStatic = true, scrollY = 0 } = {}) {
  const staticPage = { removed: false, remove() { this.removed = true; } };
  const root = { hidden: true };
  const staticStyle = { removed: false, remove() { this.removed = true; } };
  const doc = { getElementById: (id: string) => id === "omgskills-static" ? (withStatic ? staticPage : null) : id === "root" ? root : null,
    querySelectorAll: (selector: string) => selector === "[data-omgskills-static]" ? [staticStyle] : [] };
  const win = Object.assign(new EventTarget(), { scrollY, scrolledTo: -1,
    scrollTo(_x: number, y: number) { this.scrolledTo = y; }, requestAnimationFrame: (run: () => void) => { run(); return 0; },
    setTimeout: (run: () => void) => { run(); return 0; } });
  return { staticPage, staticStyle, root, doc: doc as unknown as Document, win: win as unknown as Window & typeof win };
}

test("ordinary /app pages are not takeover pages", () => {
  const { doc, win } = page({ withStatic: false });
  assert.equal(startTakeover(doc, win), false);
});

test("the static page stays until the app is ready, then the app replaces it at the top", () => {
  const { doc, win, staticPage, staticStyle, root } = page();
  assert.equal(startTakeover(doc, win), true);
  assert.equal(root.hidden, true);
  assert.equal(staticPage.removed, false);
  announceAppReady(win);
  assert.equal(root.hidden, false);
  assert.equal(staticPage.removed, true);
  assert.equal(staticStyle.removed, true, "the static page's page-wide styles must not reach the app");
  assert.equal(win.scrolledTo, 0);
});

test("a reader who has scrolled down keeps the static page until they return near the top", () => {
  const { doc, win, staticPage, root } = page({ scrollY: 900 });
  startTakeover(doc, win);
  announceAppReady(win);
  assert.equal(staticPage.removed, false);
  win.scrollY = 600; win.dispatchEvent(new Event("scroll"));
  assert.equal(root.hidden, true);
  win.scrollY = 40; win.dispatchEvent(new Event("scroll"));
  assert.equal(root.hidden, false);
  assert.equal(staticPage.removed, true);
});

test("readiness is announced even when the browser never paints a frame", () => {
  const { doc, win, root } = page();
  const paused = Object.assign(win, { requestAnimationFrame: () => 0, setTimeout: (run: () => void) => { run(); return 0; } });
  startTakeover(doc, paused);
  let events = 0;
  paused.addEventListener("omgskills:app-ready", () => events++);
  announceAppReady(paused);
  assert.equal(root.hidden, false);
  assert.equal(events, 1);
});
