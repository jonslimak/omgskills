import test from "node:test";
import assert from "node:assert/strict";
import { initialNavigation } from "../src/app/unified/model";
import { likelySignedIn, renderPublicFirst } from "../src/integration/unified/public-first";

const discover = { ...initialNavigation, view: "discover" as const };

test("Clerk's client cookie decides whether a browser likely has a session", () => {
  assert.equal(likelySignedIn(""), false);
  assert.equal(likelySignedIn("__client_uat=0"), false);
  assert.equal(likelySignedIn("theme=dark; __client_uat_Ab12=0"), false);
  assert.equal(likelySignedIn("__client_uat=1729700000"), true);
  assert.equal(likelySignedIn("a=1; __client_uat_Ab12=1729700000; b=2"), true);
  assert.equal(likelySignedIn("x__client_uat=1729700000"), false);
});

test("public views render before sign-in loads only for signed-out browsers on the enabled entry", () => {
  assert.equal(renderPublicFirst(true, discover, () => ""), true);
  assert.equal(renderPublicFirst(true, { ...discover, view: "creator", id: "anthropics" }, () => "__client_uat=0"), true);
  assert.equal(renderPublicFirst(true, discover, () => "__client_uat=1729700000"), false, "signed-in visitors keep the loading screen");
  assert.equal(renderPublicFirst(true, { ...initialNavigation, view: "all" }, () => ""), false, "private addresses wait for sign-in");
  assert.equal(renderPublicFirst(false, discover, () => ""), false, "test entries and the Mac pilot keep today's behavior");
});
