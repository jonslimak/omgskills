import assert from "node:assert/strict";

// Exercise real public hooks/UI against controlled browser responses, not a disposable backend.
const origin = process.env.PORTAL_REVIEW_ORIGIN || "http://127.0.0.1:5191";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const base = "/app/testing/unified-acceptance/?catalog=1&view=discover";
const skill = id => ({ id, name: id.split(":")[1], description: "Sample public skill", author_handle: "example",
  github_url: "https://github.com/example/skills", stars: 20, tags: [] });
const ids = Array.from({ length: 6 }, (_, i) => `example/skills:sample-${i}`);
const metadata = { collections: [
  { id: "starter", type: "topic", title: "Sample collection", subtitle: "Public examples", skillIds: ids },
  { id: "example", type: "author", title: "Sample Creator", authorHandle: "example" },
] };
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
async function setup({ holdList = false, holdMetadata = false, failList = false, failMetadata = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const calls = [], errors = [], forbidden = [];
  const list = gate(), meta = gate(), requested = gate();
  let failingList = failList, failingMetadata = failMetadata;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      if (url.hostname !== "github.com") forbidden.push(url.href);
      return route.abort();
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("manifest.json")) {
      calls.push("manifest");
      if (holdMetadata) await meta.promise;
      return failingMetadata ? json({}, 503) : json({ collections: { path: "collections-abc123.json" } });
    }
    if (url.pathname.includes("collections-abc123")) { calls.push("metadata"); return json(metadata); }
    if (url.pathname === "/catalog-skill-urls.json") return json({ skills: {} });
    if (url.pathname === "/mcp") {
      const { id, params } = request.postDataJSON();
      calls.push(params);
      if (params.name === "list_trending") {
        requested.release();
        if (holdList) await list.promise;
        if (failingList) return json({}, 503);
      }
      assert.ok(["list_trending", "get_skills", "get_skill", "search_skills"].includes(params.name));
      const data = params.name === "get_skill" ? { found: true, skill: skill(params.arguments.id) }
        : { skills: (params.name === "get_skills" ? params.arguments.ids : [ids[0]]).map(skill) };
      return json({ jsonrpc: "2.0", id, result: { structuredContent: data } });
    }
    return route.continue();
  });
  return { page, calls, list, meta, requested,
    recover: () => { failingList = false; failingMetadata = false; },
    close: async () => { list.release(); meta.release(); await context.close(); assert.deepEqual(errors, []); assert.deepEqual(forbidden, []); },
  };
}

try {
  const review = await setup({ holdList: true, failList: true });
  const { page, calls } = review;
  await page.goto(origin + base + "&authDelay=1500");
  await review.requested.promise;
  assert.equal(await page.getByText("Loading account...", { exact: true }).isVisible(), true, "Preload must start before account readiness");
  await page.getByRole("button", { name: /Collection Sample collection/ }).waitFor();
  await page.getByRole("button", { name: /Sample Creator/ }).waitFor();
  assert.equal(await page.getByRole("status", { name: "Loading trending skills" }).isVisible(), true);
  assert.equal(calls.filter(call => call.name === "list_trending").length, 1, "Preload and mounted view must share the request");
  review.list.release();
  await page.getByRole("button", { name: "Retry trending skills", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Collection Sample collection/ }).isVisible(), true);
  review.recover();
  await page.getByRole("button", { name: "Retry trending skills", exact: true }).click();
  await page.getByRole("button", { name: "Open sample-0", exact: true }).waitFor();
  await page.getByRole("button", { name: /Collection Sample collection/ }).click();
  await page.getByRole("button", { name: "Open sample-5", exact: true }).waitFor();
  assert.equal(calls.filter(call => call.name === "get_skills").length, 1);
  assert.equal(calls.filter(call => call.name === "get_skill").length, 0);
  await page.getByRole("button", { name: "Open sample-5", exact: true }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "sample-5", exact: true }).waitFor();
  assert.equal(calls.filter(call => call.name === "get_skill").length, 0, "Batch results must seed the detail cache");
  await page.keyboard.press("Escape");
  const before = calls.length;
  await page.getByRole("button", { name: "Discover", exact: true }).first().click();
  await page.getByRole("button", { name: /Collection Sample collection/ }).click();
  await page.getByRole("button", { name: "Open sample-5", exact: true }).waitFor();
  assert.equal(calls.length, before, "Fresh revisits must not refetch");
  await review.close();

  const slowMetadata = await setup({ holdMetadata: true, failMetadata: true });
  await slowMetadata.page.goto(origin + base);
  await slowMetadata.page.getByRole("button", { name: "Open sample-0", exact: true }).waitFor();
  assert.equal(await slowMetadata.page.getByRole("status", { name: "Loading collections" }).isVisible(), true);
  slowMetadata.meta.release();
  await slowMetadata.page.getByRole("button", { name: "Retry collections", exact: true }).waitFor();
  assert.equal(await slowMetadata.page.getByRole("button", { name: "Open sample-0", exact: true }).isVisible(), true);
  slowMetadata.recover();
  await slowMetadata.page.getByRole("button", { name: "Retry collections", exact: true }).click();
  await slowMetadata.page.getByRole("button", { name: /Collection Sample collection/ }).waitFor();
  await slowMetadata.close();

  const privateEntry = await setup();
  await privateEntry.page.goto(origin + "/app/testing/unified-acceptance/?catalog=1&authDelay=1500&view=set&id=private-set&q=private-term&skill=synced:private");
  await privateEntry.requested.promise;
  assert.ok(!JSON.stringify(privateEntry.calls).includes("private"), "Preload must not send private state to public APIs");
  await privateEntry.close();
  console.log("PASS: preload before account readiness; shared requests; independent sections and retry; six skills in one batch; cached details/revisits; no private data requests.");
} finally {
  await browser.close();
}
