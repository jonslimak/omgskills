import test from "node:test";
import assert from "node:assert/strict";
import { initialNavigation, navigationLocation, openSkillNavigation, type SkillDisplay } from "../src/app/unified/model";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { entryNavigation } from "../src/integration/unified/entry-navigation";

// Regression for the bug where opening one of your own skills from Discover search did nothing.
const search = { ...initialNavigation, view: "discover" as const, query: "brand" };
const personal = { key: "synced:brand-voice-Codex", name: "brand-voice", description: "", author: "", githubUrl: null, tags: [] } as unknown as SkillDisplay;

test("a personal search result stays selected, survives a refresh and never reaches public requests", () => {
  const opened = accountNavigation(openSkillNavigation(search, personal), true);
  assert.equal(opened.selected, "synced:brand-voice-Codex");
  assert.equal(opened.query, "brand");

  const address = navigationLocation(opened, true);
  assert.match(address, /^\?view=discover&q=brand&skill=synced%3Abrand-voice-Codex$/, "private selections keep the ?view= form");
  const [pathname, search_] = ["/app/", address];
  assert.deepEqual(accountNavigation(entryNavigation(pathname, search_, "/app/"), true), opened);

  assert.equal(publicNavigation(opened).selected, "", "the private ID is not sent to the public catalog");
  assert.equal(accountNavigation(opened, false).selected, "", "signed out, the private selection is dropped");
});
