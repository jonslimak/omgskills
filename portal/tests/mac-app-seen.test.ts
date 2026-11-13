import test from "node:test";
import assert from "node:assert/strict";
import { MAC_APP_SEEN_WINDOW_MS, macAppSeen, type PortalDevice } from "../src/app/model";

const now = Date.parse("2026-11-12T12:00:00Z");
const mac = (extra: Partial<PortalDevice>): PortalDevice => ({ id: "m", name: "Mac", lastActive: "", status: "active", ...extra });
const ago = (ms: number) => new Date(now - ms).toISOString();

test("the install pop-over assumes the app only on a Mac that checked in lately", () => {
  assert.equal(macAppSeen([], now), false);
  assert.equal(macAppSeen([mac({ lastCheckedAt: ago(60 * 60 * 1000) })], now), true);
  assert.equal(macAppSeen([mac({ lastCheckedAt: null, lastReportedAt: ago(5 * 60 * 1000) })], now), true);
  // Removed app: no check-in for over a week.
  assert.equal(macAppSeen([mac({ lastCheckedAt: ago(MAC_APP_SEEN_WINDOW_MS + 1), lastReportedAt: ago(MAC_APP_SEEN_WINDOW_MS * 3) })], now), false);
  assert.equal(macAppSeen([mac({ lastCheckedAt: null, lastReportedAt: null })], now), false);
  assert.equal(macAppSeen([mac({ status: "revoked", lastCheckedAt: ago(1000) })], now), false);
  // Older inventory without check-in times keeps the old rule: any active Mac.
  assert.equal(macAppSeen([mac({})], now), true);
  assert.equal(macAppSeen([mac({ status: "expired" })], now), false);
});
