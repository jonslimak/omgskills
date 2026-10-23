import assert from "node:assert/strict";
import test from "node:test";
import { createSkillReadmeHandler } from "./skill-readme.js";

const id = "owner/repo:skills/design";
const skill = { id, github_url: "https://github.com/owner/repo" };
const request = (value = id) => new Request(`https://omgskills.com/api/public/skill-readme?id=${encodeURIComponent(value)}`);
function github(markdown: string | Uint8Array<ArrayBuffer> = "# Repository\n\nRead the docs.") {
  return new Response(markdown, { headers: { "content-type": "text/plain; charset=utf-8" } });
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
  assert.equal(calls[1].url, "https://raw.githubusercontent.com/owner/repo/HEAD/README.md");
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
  assert.equal(value.readme.sourceUrl, "https://github.com/owner/repo/blob/HEAD/README.md");
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
  assert.deepEqual(await response.json(), { skillId: id, skill: null, readme: null });
  const names = calls; // every README name was tried once
  await handler(request());
  assert.equal(calls, names);
  time = 60_001;
  await handler(request());
  assert.equal(calls, names * 2);
  for (const status of [403, 429, 500]) {
    let attempts = 0;
    const retryable = createSkillReadmeHandler({ lookupSkill, fetcher: async () => ++attempts === 1 ? new Response("", { status }) : github() });
    assert.equal((await retryable(request())).status, 503);
    assert.equal((await retryable(request())).status, 200);
    assert.equal(attempts, 2);
  }
});

test("README file names are tried in order and missing names fall through", async () => {
  const urls: string[] = [];
  const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async input => {
    urls.push(String(input));
    return String(input).endsWith("/readme.md") ? github("# lower") : new Response("404: Not Found", { status: 404 });
  } });
  const value = await (await handler(request())).json();
  assert.deepEqual(urls.map(url => url.split("/HEAD/")[1]), ["README.md", "readme.md"]);
  assert.equal(value.readme.sourceUrl, "https://github.com/owner/repo/blob/HEAD/readme.md");
});

test("README source links preserve repository names beginning with HEAD", async () => {
  for (const repository of ["owner/HEAD-tools", "HEAD-owner/HEAD"]) {
    const handler = createSkillReadmeHandler({
      lookupSkill: async () => ({ id, github_url: `https://github.com/${repository}` }),
      fetcher: async () => github(),
    });
    const value = await (await handler(request())).json();
    assert.equal(value.readme.sourceUrl, `https://github.com/${repository}/blob/HEAD/README.md`);
  }
});

test("README filename fallbacks share one timeout budget and remain retryable", async () => {
  const signals: AbortSignal[] = [];
  let retry = false;
  const handler = createSkillReadmeHandler({ lookupSkill, timeoutMs: 20, fetcher: async (_url, init) => {
    if (retry) return github();
    const signal = init!.signal!;
    signals.push(signal);
    if (signals.length === 1) return new Response("", { status: 404 });
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout did not abort")), 500);
      const aborted = () => { clearTimeout(timer); resolve(new Response("", { status: 404 })); };
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
    });
  } });
  assert.equal((await handler(request())).status, 503);
  assert.equal(signals[1], signals[0], "each fallback must use the same timeout signal");
  assert.equal(signals.length, 2, "an exhausted timeout must stop further filename attempts");
  retry = true;
  assert.equal((await handler(request())).status, 200);
});

test("README text is truncated independently of the description", async () => {
  const text = "# Long README\n" + "x".repeat(22_000);
  const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github(text) });
  const value = await (await handler(request())).json();
  assert.equal(value.readme.markdown.length, 20_000);
  assert.equal(value.readme.truncated, true);
});

test("oversized declared and streaming responses are bounded", async () => {
  for (const response of [new Response("", { headers: { "content-length": "256001" } }), new Response("x".repeat(256_001))]) {
    const handler = createSkillReadmeHandler({ lookupSkill, fetcher: async () => response });
    assert.equal((await handler(request())).status, 503);
  }
});

test("malformed catalog identity or README data cannot be cached as a successful document", async () => {
  const wrong = createSkillReadmeHandler({ lookupSkill: async () => ({ ...skill, id: "wrong" }) });
  assert.equal((await wrong(request())).status, 503);
  const invalidUtf8 = createSkillReadmeHandler({ lookupSkill, fetcher: async () => github(new Uint8Array([0xff, 0xfe, 0xfd]) as Uint8Array<ArrayBuffer>) });
  assert.equal((await invalidUtf8(request())).status, 503);
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

test("both documents load together: SKILL.md without metadata, and the folder README else the repo README", async () => {
  const files: Record<string, string> = {
    "skills/design/README.md": "# Design skill\n\nHow to use it.",
    "skills/design/SKILL.md": "---\nname: design\ndescription: x\n---\n\n# Instructions\n\nDo this.",
    "README.md": "# Whole repository",
  };
  const run = async (available: string[], skill_md_path: string | null = "skills/design/SKILL.md") => {
    const urls: string[] = [];
    const handler = createSkillReadmeHandler({ lookupSkill: async value => ({ id: value, github_url: "https://github.com/owner/repo", skill_md_path }),
      fetcher: async input => {
        const path = String(input).split("/HEAD/")[1];
        urls.push(path);
        return available.includes(path) ? github(files[path]) : new Response("404: Not Found", { status: 404 });
      } });
    return { value: await (await handler(request())).json(), urls };
  };
  const all = await run(Object.keys(files));
  assert.equal(all.value.skill.kind, "skill");
  assert.equal(all.value.skill.markdown, "# Instructions\n\nDo this.");
  assert.equal(all.value.skill.sourceUrl, "https://github.com/owner/repo/blob/HEAD/skills/design/SKILL.md");
  assert.equal(all.value.readme.kind, "skill-readme");
  assert.equal(all.value.readme.sourceUrl, "https://github.com/owner/repo/blob/HEAD/skills/design/README.md");
  const repoOnly = await run(["skills/design/SKILL.md", "README.md"]);
  assert.equal(repoOnly.value.readme.kind, "repository");
  const noSkill = await run(["README.md"]);
  assert.equal(noSkill.value.skill, null);
  assert.equal(noSkill.value.readme.kind, "repository");
  for (const unsafe of ["../SKILL.md", "/etc/SKILL.md", "skills/design/notes.md", "skills\\design/SKILL.md", null]) {
    const fallback = await run(Object.keys(files), unsafe);
    assert.equal(fallback.value.skill, null, String(unsafe));
    assert.equal(fallback.value.readme.kind, "repository", String(unsafe));
    assert.deepEqual(fallback.urls, ["README.md"]);
  }
});

test("repo-level skills also show a root SKILL.md first", async () => {
  const handler = createSkillReadmeHandler({
    lookupSkill: async value => ({ id: value, github_url: "https://github.com/owner/repo", skill_md_path: "SKILL.md" }),
    fetcher: async input => {
      const path = String(input).split("/HEAD/")[1];
      return path === "SKILL.md" ? github("---\nname: x\n---\n# Skill") : path === "README.md" ? github("# Repo") : new Response("", { status: 404 });
    } });
  const value = await (await handler(request("owner/repo"))).json();
  assert.equal(value.skill.kind, "skill");
  assert.equal(value.skill.markdown, "# Skill");
  assert.equal(value.readme.kind, "repository");
});

test("one failed document preserves the other and remains retryable without refetching the good document", async () => {
  for (const failedKind of ["skill", "readme"] as const) {
    for (const failure of ["http", "oversized", "timeout"] as const) {
      let recovered = false;
      const calls = { skill: 0, readme: 0 };
      const handler = createSkillReadmeHandler({
        lookupSkill: async value => ({ id: value, github_url: "https://github.com/owner/repo", skill_md_path: "SKILL.md" }),
        timeoutMs: 20,
        fetcher: async (input, init) => {
          const kind = String(input).endsWith("/SKILL.md") ? "skill" : "readme";
          calls[kind]++;
          if (kind === failedKind && !recovered) {
            if (failure === "http") return new Response("", { status: 500 });
            if (failure === "oversized") return new Response("", { headers: { "content-length": "256001" } });
            return new Promise<Response>((_resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Timeout did not abort")), 500);
              const abort = () => { clearTimeout(timer); reject(new Error("Timed out")); };
              if (init!.signal!.aborted) abort();
              else init!.signal!.addEventListener("abort", abort, { once: true });
            });
          }
          return github(kind === "skill" ? "# Instructions" : "# README");
        },
      });
      const response = await handler(request());
      assert.equal(response.status, 200, `${failedKind}: ${failure}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
      const value = await response.json();
      const goodKind = failedKind === "skill" ? "readme" : "skill";
      assert.equal(value[failedKind], null);
      assert.ok(value[goodKind]?.markdown);
      recovered = true;
      const retry = await handler(request());
      const retried = await retry.json();
      assert.ok(retried.skill?.markdown);
      assert.ok(retried.readme?.markdown);
      assert.equal(calls[goodKind], 1, "keep the successful document cached independently");
      assert.equal(calls[failedKind], 2, "retry the failed document immediately");
      assert.match(retry.headers.get("netlify-cdn-cache-control")!, /max-age=600/);
    }
  }
});

test("a failed document with no usable alternative remains a retryable error", async () => {
  let recovered = false;
  const handler = createSkillReadmeHandler({
    lookupSkill: async value => ({ id: value, github_url: "https://github.com/owner/repo", skill_md_path: "SKILL.md" }),
    fetcher: async input => String(input).endsWith("/SKILL.md")
      ? recovered ? github("# Instructions") : new Response("", { status: 500 })
      : new Response("", { status: 404 }),
  });
  assert.equal((await handler(request())).status, 503);
  recovered = true;
  assert.equal((await handler(request())).status, 200);
});
