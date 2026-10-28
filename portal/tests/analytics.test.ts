import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trackEvent } from "../src/app/unified/analytics";

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
