import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createLiveLinkVerifier } from "./web-library-live-links.mjs";
import { skillPathForId } from "./web-library-skill-urls.mjs";

const origin = "https://preview.example";
const internalStatus = (status) => [200, 301, 302, 308].includes(status);
const llmsStatus = (status, path) => status === 200 || (path === "/mcp" && status === 405);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("checks four distinct links at once, reuses duplicates and consumes bodies", async () => {
  const release = deferred();
  const calls = [];
  const consumed = [];
  const logs = [];
  let active = 0;
  let peak = 0;
  const verify = createLiveLinkVerifier({
    origin,
    log: (line) => logs.push(line),
    fetchLive: async (url, options) => {
      assert.deepEqual(options, { redirect: "manual" });
      calls.push(url);
      active += 1;
      peak = Math.max(peak, active);
      await release.promise;
      return {
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); consumed.push(url); active -= 1; },
          cancel: () => assert.fail("Do not close reusable connections by cancelling bodies"),
        },
      };
    },
  });
  const paths = Array.from({ length: 9 }, (_, i) => `/page-${i}/`);
  const checking = verify([...paths, paths[0], paths[1]], { label: "homepage", acceptStatus: internalStatus });
  await tick();
  assert.equal(calls.length, 4);
  release.resolve();
  await checking;
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(new Set(calls), new Set(paths.map((path) => origin + path)));
  assert.equal(calls.length, 9);
  assert.equal(consumed.length, 9);
  await verify(paths, { label: "another page", acceptStatus: internalStatus });
  assert.equal(calls.length, 9, "reuse link status across pages in this verifier run");
  assert.match(logs[0], /homepage.*0\/9/);
  assert(logs.some((line) => /homepage.*9\/9/.test(line)));
});

test("link sweeps reuse HTTP connections instead of reconnecting for each page", async () => {
  let connections = 0;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("first chunk".repeat(2_000));
    const timer = setTimeout(() => response.end("last chunk".repeat(2_000)), 5);
    response.on("close", () => clearTimeout(timer));
  });
  server.on("connection", () => connections++);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const verify = createLiveLinkVerifier({ origin: localOrigin, fetchLive: fetch, log: () => {} });
    await verify(Array.from({ length: 80 }, (_, i) => `/page-${i}/`), {
      label: "connection reuse regression", acceptStatus: status => status === 200,
    });
    assert.ok(connections <= 8, `80 pages opened ${connections} connections; expected reusable worker connections`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("cached status still obeys each caller's stricter rules", async () => {
  const calls = [];
  const verify = createLiveLinkVerifier({
    origin, log: () => {},
    fetchLive: async (url) => { calls.push(url); return { status: 302, body: null }; },
  });
  await verify(["/redirect"], { label: "homepage", acceptStatus: internalStatus });
  await assert.rejects(
    verify(["/redirect"], { label: "llms.txt", acceptStatus: llmsStatus }),
    /llms.txt linked to \/redirect, which returned 302/,
  );
  assert.equal(calls.length, 1);
});

test("preserves internal redirect allowances, missing-link failures and MCP exception", async () => {
  const verify = createLiveLinkVerifier({
    origin, log: () => {},
    fetchLive: async (url) => ({ status: Number(new URL(url).pathname.slice(1)), body: null }),
  });
  await verify(["/200", "/301", "/302", "/308"], { label: "page", acceptStatus: internalStatus });
  for (const status of [401, 403, 404, 405, 500]) {
    await assert.rejects(
      verify([`/${status}`], { label: "page", acceptStatus: internalStatus }),
      new RegExp(`page linked to /${status}, which returned ${status}`),
    );
  }
  const mcp = createLiveLinkVerifier({
    origin, log: () => {}, fetchLive: async () => ({ status: 405, body: null }),
  });
  await mcp(["/mcp"], { label: "llms.txt", acceptStatus: llmsStatus });
  await assert.rejects(mcp(["/other"], { label: "llms.txt", acceptStatus: llmsStatus }), /returned 405/);
});

test("stops scheduling on failure and waits for already active work", async () => {
  const release = deferred();
  const failed = deferred();
  const calls = [];
  let active = 0;
  const verify = createLiveLinkVerifier({
    origin, log: () => {},
    fetchLive: async (url) => {
      calls.push(url);
      if (url.endsWith("/bad")) { failed.resolve(); throw new Error("fetch exhausted its retries"); }
      active += 1;
      await release.promise;
      active -= 1;
      return { status: 200, body: null };
    },
  });
  let settled = false;
  const checking = verify(["/bad", "/a", "/b", "/c", "/unscheduled"], {
    label: "page", acceptStatus: internalStatus,
  });
  const rejected = assert.rejects(checking, /fetch exhausted its retries/).then(() => { settled = true; });
  await failed.promise;
  await tick();
  assert.equal(calls.length, 4);
  assert.equal(settled, false);
  release.resolve();
  await rejected;
  assert.equal(active, 0);
  assert.equal(calls.length, 4);
});

test("caches are scoped to one origin/run and do not hide a later failure", async () => {
  const calls = [];
  const fetchLive = async (url) => { calls.push(url); return { status: calls.length === 1 ? 200 : 404, body: null }; };
  const first = createLiveLinkVerifier({ origin, fetchLive, log: () => {} });
  await first(["/same"], { label: "draft", acceptStatus: internalStatus });
  const second = createLiveLinkVerifier({ origin: "https://production.example", fetchLive, log: () => {} });
  await assert.rejects(second(["/same"], { label: "production", acceptStatus: internalStatus }), /returned 404/);
  assert.deepEqual(calls, [`${origin}/same`, "https://production.example/same"]);
});

test("logs intermediate progress and handles empty batches", async () => {
  const logs = [];
  const verify = createLiveLinkVerifier({
    origin, log: (line) => logs.push(line), fetchLive: async () => ({ status: 200, body: null }),
  });
  await verify(Array.from({ length: 30 }, (_, i) => `/${i}`), { label: "links", acceptStatus: internalStatus });
  assert(logs.some((line) => /25\/30/.test(line)));
  assert(logs.some((line) => /30\/30/.test(line)));
  await verify([], { label: "empty", acceptStatus: internalStatus });
  assert(logs.some((line) => /empty.*0\/0/.test(line)));
});

test("main verifier wires both link sweeps without weakening timeouts or retries", async () => {
  const source = await readFile(new URL("./verify-web-library-pages.mjs", import.meta.url), "utf8");
  const transport = await readFile(new URL("./verification-fetch.mjs", import.meta.url), "utf8");
  assert.match(source, /createLiveLinkVerifier\(\{ origin, fetchLive \}\)/);
  assert.match(source, /verifyLiveLinks\(internalLinks\(html\)/);
  assert.match(source, /verifyLiveLinks\(llmsUrls\(text\)/);
  assert.match(source, /fetchForVerification\(url, options, \{ timeoutMs: 15_000 \}\)/);
  assert.match(transport, /const attempts = 3;/);
  assert.match(transport, /AbortSignal.timeout\(timeoutMs\)/);
  assert.match(transport, /const delay = 500 \* attempt/);
  assert.match(source, /status === 200 \|\| \(urlPath === "\/mcp" && status === 405\)/);
  assert.match(source, /\[200, 301, 302, 308\]\.includes\(status\)/);
});

test("OpenAI verification examples remain featured and are not suppressed", async () => {
  const source = await readFile(new URL("./verify-web-library-pages.mjs", import.meta.url), "utf8");
  const curations = JSON.parse(await readFile(new URL("../index/curations/collections.json", import.meta.url), "utf8"));
  const suppressions = JSON.parse(await readFile(new URL("../index/seeds/suppressed-skills.json", import.meta.url), "utf8"));
  const suppressedIds = new Set(suppressions.skills.map((skill) => skill.id));
  const featuredPaths = new Set(curations.authorOverrides.openai.featuredSkillIds
    .filter((id) => !suppressedIds.has(id))
    .map(skillPathForId));
  const examples = [...source.matchAll(/path: "(\/skills\/openai\/[^"]+)"/g)].map((match) => match[1]);
  assert.equal(examples.length, 2);
  for (const example of examples) {
    assert(featuredPaths.has(example), `${example} must remain an active featured skill, not a removed example`);
  }
});

test("llms.txt example comes from generated pages even when an old example remains in the catalog", async () => {
  const source = await readFile(new URL("./build-web-library.mjs", import.meta.url), "utf8");
  const selection = source.match(/const llmsExampleSkill = ([^;]+);/);
  assert(selection, "builder must select an example skill");
  const obsolete = { id: "openai/codex:code-review" };
  const generated = { id: "openai/codex:skill-creator" };
  const result = runInNewContext(selection[1], {
    skillById: new Map([[obsolete.id, obsolete], [generated.id, generated]]),
    includedSkills: [generated],
  });
  assert.equal(result, generated);
});
