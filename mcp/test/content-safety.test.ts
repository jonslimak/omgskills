import assert from "node:assert/strict";
import test from "node:test";
import { readSkillContent } from "../src/content.js";
import { gitBlobSha } from "../src/install.js";
import type { SkillResult } from "../src/library.js";

const limit = 256 * 1024;
const skill = { id: "owner/repo:skill", github_url: "https://github.com/owner/repo", skill_md_path: "skill/SKILL.md" } as SkillResult;
const read = (response: Response) => readSkillContent(skill, 60000, (async () => response) as typeof fetch);

test("rejects oversized declared bodies before reading them", async () => {
  let reads = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(limit)); if (reads === 2) controller.close(); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  await assert.rejects(read(new Response(body, { headers: { "Content-Length": String(limit + 1) } })), /unusually large/);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

for (const length of [undefined, "1"]) test(`bounds streamed bodies with Content-Length ${length}`, async () => {
  let reads = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(limit / 2)); if (reads === 4) controller.close(); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  await assert.rejects(read(new Response(body, { headers: length ? { "Content-Length": length } : {} })), /unusually large/);
  assert.equal(reads, 3);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("allows the byte limit and verifies the full body before display truncation", async () => {
  const content = "a".repeat(limit);
  const result = await readSkillContent({ ...skill, skill_md_sha: gitBlobSha(new TextEncoder().encode(content)) }, 500,
    (async () => new Response(content)) as typeof fetch);
  assert.equal(result.verified, true);
  assert.equal(result.truncated, true);
  assert.equal(result.content.length, 500);
  await assert.rejects(read(new Response("\u00e9".repeat(limit))), /unusually large/);
});

test("stream failures release the reader and return a safe error", async () => {
  const body = new ReadableStream({ start(controller) { controller.error(new Error("private diagnostic")); } });
  await assert.rejects(read(new Response(body)), error => error instanceof Error && /GitHub/.test(error.message) && !error.message.includes("private diagnostic"));
  assert.equal(body.locked, false);
});

test("redirects are manual, same-origin only, and bounded", async () => {
  const requested: string[] = [];
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    requested.push(String(url));
    assert.equal(options?.redirect, "manual");
    return requested.length === 1 ? new Response(null, { status: 302, headers: { Location: "/owner/renamed/HEAD/skill/SKILL.md" } }) : new Response("safe");
  }) as typeof fetch;
  assert.equal((await readSkillContent(skill, 500, fetcher)).content, "safe");
  assert.equal(requested.length, 2);
  for (const location of ["https://example.com/private", "http://raw.githubusercontent.com/x", "https://user@raw.githubusercontent.com/x", "https://raw.githubusercontent.com:444/x"]) {
    let calls = 0;
    await assert.rejects(readSkillContent(skill, 500, (async () => {
      calls++; return new Response(null, { status: 302, headers: { Location: location } });
    }) as typeof fetch), /redirect/i);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(readSkillContent(skill, 500, (async () => {
    calls++; return new Response(null, { status: 302, headers: { Location: "/loop" } });
  }) as typeof fetch), /redirect/i);
  assert.ok(calls <= 4);
});

test("error responses cancel their bodies", async () => {
  for (const status of [404, 500]) {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(read(new Response(body, { status })));
    assert.equal(cancelled, true);
  }
});
