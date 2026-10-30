import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { needsAnalyticsDocumentReload, startPublicAnalytics, trackEvent } from "../src/app/unified/analytics";
import { navigationLocation } from "../src/app/unified/model";
import { entryNavigation } from "../src/integration/unified/entry-navigation";
import { accountNavigation } from "../src/integration/unified/policy";

const trackerSource = "https://app.humblytics.com/hmbl.min.js?id=a156a68";

function withBrowser(run: (state: {
  browser: { location: URL; Humblytics?: { trackClickEvent: (name: string) => void } };
  doc: { head: { append: (script: { src: string; async: boolean }) => void } };
  scripts: Array<{ src: string; async: boolean }>;
  calls: string[];
  pending: Array<() => void>;
  visit: (path: string) => void;
}) => void) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalTimeout = globalThis.setTimeout;
  const scripts: Array<{ src: string; async: boolean }> = [];
  const calls: string[] = [];
  const pending: Array<() => void> = [];
  const browser: { location: URL; Humblytics?: { trackClickEvent: (name: string) => void } } = {
    location: new URL("https://omgskills.com/app/"),
  };
  const doc = {
    querySelector: () => scripts[0] ?? null,
    createElement: () => ({ src: "", async: false }),
    head: { append: (script: { src: string; async: boolean }) => scripts.push(script) },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  globalThis.setTimeout = ((fn: () => void) => { pending.push(fn); return 1; }) as unknown as typeof setTimeout;
  try {
    run({ browser, doc, scripts, calls, pending,
      visit: path => { browser.location = new URL(path, "https://omgskills.com"); } });
  } finally {
    globalThis.setTimeout = originalTimeout;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

const publicPages = [
  "/app/", "/app/library/", "/app/library/?q=design", "/app/developers/",
  "/app/library/anthropics/skills/skills/frontend-design/",
  "/app/?view=discover", "/app/?view=developers&q=design",
  "/app/?view=discover&skill=catalog:anthropics/skills:skills/frontend-design",
  "/app/?view=top", "/app/?view=collections", "/app/?view=collection&id=design",
  "/library/anthropics/", "/developers/",
];
const privatePages = [
  "/app/library/me/", "/app/library/%6de/", "/app/profile/", "/app/pair/",
  "/app/?view=profile", "/app/?view=all", "/app/?view=sets", "/app/?view=set&id=private",
  "/app/?view=favorites", "/app/?view=devices", "/app/?view=github", "/app/?view=agents",
  "/app/?view=discover&skill=synced:private", "/app/?view=discover&source=claude",
  "/app/?view=discover&token=private", "/app/?q=private", "/app/?view=unknown",
  "/library/me/", "/library/me", "/library/%6de/", "/pair/", "/developers-private/", "/",
];

test("direct public app entries and existing public pages load exactly one tracker", () => {
  withBrowser(({ browser, visit, scripts }) => {
    for (const path of publicPages) {
      scripts.length = 0;
      visit(path);
      startPublicAnalytics();
      startPublicAnalytics();
      assert.deepEqual(scripts, [{ src: trackerSource, async: true }], path);
    }
    scripts.length = 0;
    visit("https://www.omgskills.com/app/");
    startPublicAnalytics();
    assert.equal(scripts.length, 1);
    scripts.length = 0;
    browser.Humblytics = { trackClickEvent: () => {} };
    startPublicAnalytics();
    assert.equal(scripts.length, 0, "an already loaded SDK is not loaded again");
  });
});

test("private entries and nonproduction hosts never load or send analytics", () => {
  withBrowser(({ browser, visit, scripts, calls, pending }) => {
    browser.Humblytics = { trackClickEvent: name => calls.push(name) };
    for (const path of privatePages) {
      visit(path);
      startPublicAnalytics();
      trackEvent("App Search");
    }
    browser.Humblytics = undefined;
    for (const host of ["localhost", "preview.netlify.app", "app.omgskills.com", "omgskills.com.example.org"]) {
      for (const path of ["/app/", "/app/library/", "/library/anthropics/"]) {
        visit(`https://${host}${path}`);
        startPublicAnalytics();
        trackEvent("App Search");
      }
    }
    assert.deepEqual(scripts, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(pending, []);
  });
});

test("tracked public navigation keeps its tracker but leaving for private UI requires a full reload", () => {
  withBrowser(({ visit, scripts }) => {
    visit("/library/anthropics/");
    startPublicAnalytics();
    for (const path of publicPages) assert.equal(needsAnalyticsDocumentReload(path), false, path);
    for (const path of privatePages) assert.equal(needsAnalyticsDocumentReload(path), true, path);
    scripts.length = 0;
    assert.equal(needsAnalyticsDocumentReload("/app/?view=profile"), false, "untracked navigation stays unchanged");
  });
});

test("direct public app entries send existing named events after the asynchronous SDK loads", () => {
  withBrowser(({ browser, visit, calls, pending }) => {
    visit("/app/");
    startPublicAnalytics();
    trackEvent("App Search");
    assert.equal(pending.length, 1);
    browser.Humblytics = { trackClickEvent: name => calls.push(name) };
    pending.shift()!();
    visit("/app/library/?q=design");
    trackEvent("App Skill Open");
    trackEvent("App Copy Install");
    assert.deepEqual(calls, ["App Search", "App Skill Open", "App Copy Install"]);
    for (const path of privatePages) {
      visit(path);
      trackEvent("App Search");
    }
    assert.equal(calls.length, 3, "a loaded tracker cannot send private events");
  });
});

test("delayed events are discarded when navigation crosses into private UI", () => {
  withBrowser(({ browser, visit, calls, pending }) => {
    visit("/app/");
    startPublicAnalytics();
    trackEvent("App Search");
    assert.equal(pending.length, 1);
    visit("/app/?view=profile");
    browser.Humblytics = { trackClickEvent: name => calls.push(name) };
    pending.shift()!();
    assert.deepEqual(calls, []);
    assert.deepEqual(pending, []);
  });
});

test("navigating from a private page to a public page starts tracking without duplicate scripts", () => {
  withBrowser(({ visit, scripts }) => {
    visit("/app/?view=sets");
    startPublicAnalytics();
    assert.equal(scripts.length, 0);
    visit("/app/library/");
    startPublicAnalytics();
    startPublicAnalytics();
    assert.equal(scripts.length, 1);
    const session = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
    assert.match(session, /useEffect\(\(\) => \{ startPublicAnalytics\(\); \}, \[current, requested\]\)/);
  });
});

test("signed-out private-to-Discover navigation must retrigger analytics even when the public target is unchanged", () => {
  for (const view of ["profile", "sets", "all"]) {
    const requested = entryNavigation("/app/", `?view=${view}`, "/app/");
    const displayed = accountNavigation(requested, false);
    const next = accountNavigation({ ...displayed, view: "discover" }, false);
    assert.equal(displayed.view, "discover");
    assert.notDeepEqual(requested, next);
    assert.equal(navigationLocation(displayed, true), navigationLocation(next, true), "current alone cannot detect this navigation");
  }
  const session = readFileSync(new URL("../src/integration/unified/Session.tsx", import.meta.url), "utf8");
  assert.match(session, /useEffect\(\(\) => \{ startPublicAnalytics\(\); \}, \[current, requested\]\)/);
});

test("blocked analytics never breaks the app and SDK retries are bounded", () => {
  withBrowser(({ browser, doc, pending }) => {
    doc.head.append = () => { throw new Error("blocked script"); };
    assert.doesNotThrow(() => startPublicAnalytics());
    trackEvent("App Search");
    let retries = 0;
    while (pending.length && retries < 20) { pending.shift()!(); retries++; }
    assert.equal(retries, 9);
    assert.deepEqual(pending, []);
    browser.Humblytics = { trackClickEvent: () => { throw new Error("tracker unavailable"); } };
    assert.doesNotThrow(() => trackEvent("App Search"));
  });
});

test("the shared app shell never loads the automatic tracker unconditionally", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /humblytics\.com\/hmbl|Humblytics/);
});
