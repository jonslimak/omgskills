import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { needsAnalyticsDocumentReload, startPublicAnalytics, trackEvent } from "../src/app/unified/analytics";

test("public pages load one tracker; private pages and nonproduction hosts never load it", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const scripts: Array<{ src: string; async: boolean }> = [];
  const browser = { location: { hostname: "omgskills.com", pathname: "/app/", href: "https://omgskills.com/app/" } };
  const doc = {
    querySelector: () => scripts[0] ?? null,
    createElement: () => ({ src: "", async: false }),
    head: { append: (script: { src: string; async: boolean }) => scripts.push(script) },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    for (const path of ["/app/", "/app/library/", "/library/me/", "/library/me", "/library/%6de/", "/pair/", "/developers-private/", "/"]) {
      browser.location.pathname = path;
      startPublicAnalytics();
    }
    assert.equal(scripts.length, 0);
    browser.location.pathname = "/library/anthropics/";
    for (const host of ["localhost", "preview.netlify.app", "app.omgskills.com"]) {
      browser.location.hostname = host;
      startPublicAnalytics();
    }
    assert.equal(scripts.length, 0);
    for (const path of ["/library/anthropics/", "/developers/"]) {
      scripts.length = 0;
      browser.location.hostname = "omgskills.com";
      browser.location.pathname = path;
      startPublicAnalytics();
      startPublicAnalytics();
      assert.deepEqual(scripts, [{ src: "https://app.humblytics.com/hmbl.min.js?id=a156a68", async: true }]);
      assert.equal(needsAnalyticsDocumentReload("/app/?view=sets"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/profile/"), true);
      assert.equal(needsAnalyticsDocumentReload("/library/me/"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/library/me/"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/library/%6de/"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/library/?q=design"), false, "public search keeps focus without a reload");
      assert.equal(needsAnalyticsDocumentReload("/app/?view=developers&q=design"), false, "contextual search keeps its public view");
      assert.equal(needsAnalyticsDocumentReload("/app/?view=profile&q=design"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/?view=discover&skill=synced:private"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/?view=discover&source=claude"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/?view=discover&token=private"), true);
      assert.equal(needsAnalyticsDocumentReload("/app/library/anthropics/skills/skills/frontend-design/"), false);
      assert.equal(needsAnalyticsDocumentReload("/app/developers/"), false);
      assert.equal(needsAnalyticsDocumentReload("/developers/"), false);
      assert.equal(needsAnalyticsDocumentReload("/library/anthropics/"), false);
      scripts.length = 0;
      assert.equal(needsAnalyticsDocumentReload("/app/"), false, "untracked app navigation stays unchanged");
    }
    doc.head.append = () => { throw new Error("blocked script"); };
    assert.doesNotThrow(() => startPublicAnalytics());
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("a public entry keeps named events through public SPA navigation, not private navigation", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: string[] = [];
  let hasTracker = true;
  const browser = {
    location: { hostname: "omgskills.com", pathname: "/app/library/", href: "https://omgskills.com/app/library/?q=design" },
    Humblytics: { trackClickEvent: (name: string) => calls.push(name) },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => hasTracker ? {} : null } });
  try {
    trackEvent("App Search");
    trackEvent("App Skill Open");
    trackEvent("App Copy Install");
    assert.deepEqual(calls, ["App Search", "App Skill Open", "App Copy Install"]);
    hasTracker = false;
    trackEvent("App Search");
    assert.equal(calls.length, 3, "direct /app/ visits do not opt into tracking");
    hasTracker = true;
    browser.location.href = "https://omgskills.com/app/?view=profile";
    browser.location.pathname = "/app/";
    trackEvent("App Search");
    assert.equal(calls.length, 3);
    assert.equal(needsAnalyticsDocumentReload(browser.location.href), true);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("named events stay on existing public pages, including delayed retries", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalTimeout = globalThis.setTimeout;
  const calls: string[] = [];
  const pending: Array<() => void> = [];
  const browser = {
    location: { hostname: "omgskills.com", pathname: "/library/anthropics/" },
    Humblytics: undefined as undefined | { trackClickEvent: (name: string) => void },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  globalThis.setTimeout = ((fn: () => void) => { pending.push(fn); return 1; }) as unknown as typeof setTimeout;
  try {
    trackEvent("App Search");
    assert.equal(pending.length, 1);
    browser.location.pathname = "/app/";
    browser.Humblytics = { trackClickEvent: (name) => { calls.push(name); } };
    pending.shift()!();
    trackEvent("App Skill Open");
    assert.deepEqual(calls, []);
    for (const path of ["/", "/pair/", "/library/me/", "/developers-private/"]) {
      browser.location.pathname = path;
      trackEvent("App Search");
    }
    assert.deepEqual(calls, []);
    browser.location.pathname = "/developers/";
    trackEvent("App Copy Install");
    browser.location.pathname = "/library/anthropics/";
    trackEvent("App Skill Open");
    assert.deepEqual(calls, ["App Copy Install", "App Skill Open"]);
    browser.location.hostname = "localhost";
    trackEvent("App Search");
    assert.equal(calls.length, 2);
    browser.location.hostname = "omgskills.com";
    browser.Humblytics.trackClickEvent = () => { throw new Error("tracker unavailable"); };
    assert.doesNotThrow(() => trackEvent("App Search"));
  } finally {
    globalThis.setTimeout = originalTimeout;
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("the private app shell does not load the automatic tracker", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /humblytics\.com\/hmbl|Humblytics/);
});
