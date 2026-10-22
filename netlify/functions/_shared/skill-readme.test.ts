import assert from "node:assert/strict";
import test from "node:test";
import { createSkillReadmeHandler } from "./skill-readme.js";

const id = "owner/repo:skills/design";
const skill = { id, github_url: "https://github.com/owner/repo" };
const request = (value = id) => new Request(`https://omgskills.com/api/public/skill-readme?id=${encodeURIComponent(value)}`);
function github(markdown = "# Repository\n\nRead the docs.", extra = {}) {
  return Response.json({ encoding: "base64", size: Buffer.byteLength(markdown), content: Buffer.from(markdown).toString("base64"),
    html_url: "https://github.com/owner/repo/blob/develop/README.md", ...extra });
}
const lookupSkill = async (value: string) => ({ ...skill, id: value });

test("README lookup uses the exact public catalog ID and sends no account credentials upstream", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const handler = createSkillReadmeHandler({ fetcher: async (input, init) => {
    const url = String(input); calls.push({ url, init: init! });
    return url.endsWith("/mcp") ? Response.json({ id: 1, result: { structuredContent: { found: true, skill } } }) : github();
  } });
  const response = await handler(new Request(request(), { headers: { Authorization: "Bearer private", Cookie: "session=private" } }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://omgskills.com/mcp");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).params, { name: "get_skill", arguments: { id } });
  assert.equal(calls[1].url, "https://api.github.com/repos/owner/repo/readme");
  assert.ok(!calls[1].url.includes("ref="), "GitHub must use its actual default branch");
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "error");
  }
  const value = await response.json();
  assert.equal(value.skillId, id);
  assert.equal(value.readme.repository, "owner/repo");
  assert.equal(value.readme.truncated, false);
  assert.match(response.headers.get("netlify-cdn-cache-control")!, /max-age=600/);
  assert.equal(response.headers.get("netlify-vary"), "query=id");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
});

test("invalid/private identifiers, extra query fields and non-GET methods never reach upstream", async () => {
  let calls = 0;
  const handler = createSkillReadmeHandler({ lookupSkill: async () => { calls++; return skill; } });
  for (const value of ["synced:private-id", "set-item:secret", "https://example.test/", "owner/repo:", "owner/repo:bad\nvalue"]) {
    assert.equal((await handler(request(value))).status, 400);
  }
  for (const query of ["id=owner%2Frepo%3Askill&id=other", "id=owner%2Frepo%3Askill&url=https://example.test"]) {
    assert.equal((await handler(new Request(`https://omgskills.com/api/public/skill-readme?${query}`))).status, 400);
  }
  const post = await handler(new Request(request(), { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  assert.equal(calls, 0);
});

test("unknown catalog IDs return 404 without a GitHub request; catalog errors are not hidden as missing", async () => {
  let calls = 0;
  const handler = createSkillReadmeHandler({ lookupSkill: async () => null, fetcher: async () => { calls++; return github(); } });
  assert.equal((await handler(request())).status, 404);
  assert.equal(calls, 0);
  const unavailable = createSkillReadmeHandler({ fetcher: async () => new Response("", { status: 503 }) });
  const response = await unavailable(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("only a safe public GitHub repository returned by the catalog can be requested", async () => {
  for (const github_url of ["http://github.com/owner/repo", "https://github.com.evil.test/owner/repo", "https://github.com@evil.test/owner/repo",
    "https://user:pass@github.com/owner/repo", "https://github.com:8443/owner/repo", "https://github.com/owner/repo%2Fprivate", "https://127.0.0.1/owner/repo"]) {
    let calls = 0;
    const handler = createSkillReadmeHandler({ lookupSkill: async () => ({ ...skill, github_url }), fetcher: async () => { calls++; return github(); } });
    assert.equal((await handler(request())).status, 503, github_url);
    assert.equal(calls, 0);
  }
});

test("repository cache shares in-flight reads across skills, expires and remains public-only", async () => {
  let calls = 0, time = 0;
  const handler = createSkillReadmeHandler({ lookupSkill, now: () => time, fetcher: async () => { calls++; await Promise.resolve(); return github(); } });
  const responses = await Promise.all([handler(request()), handler(request()), handler(request("owner/repo:second"))]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(calls, 1);
  await handler(request());
  assert.equal(calls, 1);
  time = 600_001;
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 2);
});

test("a missing README is a short-cached empty result, while GitHub failures are retryable", async () => {
  let calls = 0, time = 0;
  const handler = createSkillReadmeHandler({ lookupSkill, now: () => time, fetcher: async () => { calls++; return new Response("", { status: 404 }); } });
  const response = await handler(request());
  assert.deepEqual(await response.json(), { skillId: id, readme: null });
  await handler(request());
  assert.equal(calls, 1);
  time = 60_001;
  await handler(request());
  assert.equal(calls, 2);
  for (const status of [403, 429, 500]) {
    let attempts = 0;
    const retryable = createSkillReadmeHandler({ lookupSkill, fetcher: async () => ++attempts === 1 ? new Response("", { status }) : github() });
    assert.equal((await retryable(request())).status, 503);
    assert.equal((await retryable(request())).status, 200);
    assert.equal(attempts, 2);
  }
});

test("README text is truncated independently of the description and unsafe source links are rejected", async () => {
  const text = "# Long README\n" + "x".repeat(22_000);
  const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github(text) });
  const value = await (await handler(request())).json();
  assert.equal(value.readme.markdown.length, 20_000);
  assert.equal(value.readme.truncated, true);
  for (const html_url of ["javascript:alert(1)", "https://github.com/another/repo/blob/main/README.md", "https://example.test/readme"]) {
    const unsafe = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github("Readme", { html_url }) });
    assert.equal((await unsafe(request())).status, 503);
  }
});

test("oversized declared and streaming responses are bounded", async () => {
  for (const response of [new Response("", { headers: { "content-length": "512001" } }), new Response("x".repeat(512001))]) {
    const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async () => response });
    assert.equal((await handler(request())).status, 503);
  }
  const tooLarge = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github("a", { size: 256_001 }) });
  assert.equal((await tooLarge(request())).status, 503);
});

test("malformed catalog identity or README data cannot be cached as a successful document", async () => {
  const wrong = createSkillReadmeHandler({ lookupSkill: async () => ({ ...skill, id: "wrong" }) });
  assert.equal((await wrong(request())).status, 503);
  for (const extra of [{ encoding: "none" }, { content: "<>" }, { size: 100 }, { content: "", size: -1 }]) {
    const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github("readme", extra) });
    assert.equal((await handler(request())).status, 503);
  }
});

test("GitHub timeouts fail softly and do not leave a permanently pending cache entry", async () => {
  let calls = 0;
  const handler = createSkillReadmeHandler({ lookupSkill, timeoutMs: 5, fetcher: async (_url, init) => {
    if (++calls > 1) return github();
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(github()), 100);
      init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Timed out")); }, { once: true });
    });
  } });
  assert.equal((await handler(request())).status, 503);
  assert.equal((await handler(request())).status, 200);
});

test("too many unique pending requests are rejected without unbounded upstream work", async () => {
  const releases: (() => void)[] = [];
  const handler = createSkillReadmeHandler({ lookupSkill: () => new Promise(resolve => releases.push(() => resolve(null))) });
  const pending = Array.from({ length: 16 }, (_, index) => handler(request(`owner/repo:skill-${index}`)));
  assert.equal((await handler(request("owner/repo:overflow"))).status, 503);
  assert.equal(releases.length, 16);
  releases.forEach(release => release());
  assert.ok((await Promise.all(pending)).every(response => response.status === 404));
});
