import test from "node:test";
import assert from "node:assert/strict";
import { createCheckedXFetch } from "./x-search-response.js";

const searchURL = "https://x.com/i/api/graphql/query/SearchTimeline";
const timeline = { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [] } } } } };

test("valid and empty search timelines remain readable without extra requests", async () => {
  let requests = 0;
  const original = Response.json(timeline);
  const checked = createCheckedXFetch(async () => { requests++; return original; });
  const response = await checked(searchURL);
  assert.equal(response, original);
  assert.deepEqual(await response.json(), timeline);
  assert.equal(requests, 1);
});

test("HTTP 200 API errors are not mistaken for an empty feed and messages stay private", async () => {
  const checked = createCheckedXFetch(async () => Response.json({ errors: [
    { code: 32, message: "private response details" }, { code: 32 }, { message: "secret" },
  ] }));
  await assert.rejects(checked(searchURL), { message: "X search API error codes: 32, unknown" });
});

test("invalid search responses fail with safe diagnostics", async () => {
  for (const [response, message] of [
    [new Response("private", { status: 403 }), "X search HTTP 403"],
    [new Response("private"), "X search returned non-JSON data"],
    [Response.json({}), "X search response missing timeline instructions"],
    [Response.json(null), "X search response missing timeline instructions"],
  ] as const) {
    const checked = createCheckedXFetch(async () => response);
    await assert.rejects(checked(searchURL), { message });
  }
});

test("non-search requests are unchanged", async () => {
  const original = new Response("unchanged");
  const checked = createCheckedXFetch(async () => original);
  assert.equal(await checked("https://x.com/"), original);
});
