import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLiveLinkVerifier } from "./web-library-live-links.mjs";

const origin = "https://preview.example";
const internalStatus = (status) => [200, 301, 302, 308].includes(status);
const llmsStatus = (status, path) => status === 200 || (path === "/mcp" && status === 405);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("checks four distinct links at once, reuses duplicates and releases bodies", async () => {
  const release = deferred();
  const calls = [];
  const cancelled = [];
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
        body: { cancel: async () => { cancelled.push(url); active -= 1; } },
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
  assert.equal(cancelled.length, 9);
  await verify(paths, { label: "another page", acceptStatus: internalStatus });
  assert.equal(calls.length, 9, "reuse link status across pages in this verifier run");
  assert.match(logs[0], /homepage.*0\/9/);
  assert(logs.some((line) => /homepage.*9\/9/.test(line)));
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
  assert.match(source, /createLiveLinkVerifier\(\{ origin, fetchLive \}\)/);
  assert.match(source, /verifyLiveLinks\(internalLinks\(html\)/);
  assert.match(source, /verifyLiveLinks\(llmsUrls\(text\)/);
  assert.match(source, /const liveFetchAttempts = 3;/);
  assert.match(source, /AbortSignal.timeout\(15_000\)/);
  assert.match(source, /await sleep\(500 \* attempt\)/);
  assert.match(source, /status === 200 \|\| \(urlPath === "\/mcp" && status === 405\)/);
  assert.match(source, /\[200, 301, 302, 308\]\.includes\(status\)/);
});
