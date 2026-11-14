import assert from "node:assert/strict";
import test from "node:test";
import { deviceMarks, macTookApproval, MY_SKILLS_PATH } from "../src/browser-pairing";

const mac = (id: string, expiresAt: string | null) => ({ id, expiresAt });

test("Connect goes to My skills only once a Mac takes the approval", () => {
  const before = deviceMarks([mac("a", "2027-05-01T00:00:00Z"), mac("b", null)]);
  assert.equal(macTookApproval(before, [mac("a", "2027-05-01T00:00:00Z"), mac("b", null)]), false);
  assert.equal(macTookApproval(before, [mac("c", "2027-05-14T00:00:00Z"), mac("a", "2027-05-01T00:00:00Z")]), true);
  assert.equal(macTookApproval(before, [mac("a", "2027-05-14T00:00:00Z"), mac("b", null)]), true);
  assert.equal(macTookApproval(deviceMarks([]), []), false);
  assert.equal(MY_SKILLS_PATH, "/app/?view=all");
});
