import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDataWriterRuns,
  checkActiveDataWriters,
} from "./check-active-data-writers.mjs";

test("finds queued and running data writers deterministically", () => {
  assert.deepEqual(
    activeDataWriterRuns([
      { id: 3, name: "x-refresh", status: "queued" },
      { id: 2, name: "shadow-crawl-health", status: "in_progress" },
      { id: 1, name: "scrape", status: "completed" },
      { id: 4, name: "pipeline-health", status: "in_progress" },
      { id: 5, name: "deploy-current-main", status: "waiting" },
    ]),
    [
      { id: "5", name: "deploy-current-main", status: "waiting" },
      { id: "2", name: "shadow-crawl-health", status: "in_progress" },
      { id: "3", name: "x-refresh", status: "queued" },
    ],
  );
});

test("reports an idle writer queue", async () => {
  const result = await checkActiveDataWriters({
    repository: "owner/repo",
    token: "token",
    fetchImpl: async () => new Response(JSON.stringify({
      workflow_runs: [
        { id: 1, name: "shadow-crawl-health", status: "completed" },
        { id: 2, name: "pipeline-health", status: "in_progress" },
      ],
    })),
  });

  assert.equal(result.busy, false);
  assert.deepEqual(result.runs, []);
});

test("fails closed when GitHub activity cannot be checked", async () => {
  const result = await checkActiveDataWriters({
    repository: "owner/repo",
    token: "token",
    fetchImpl: async () => new Response("rate limited", { status: 403 }),
  });

  assert.equal(result.busy, true);
  assert.match(result.message, /failed closed/);
});

test("fails closed when configuration is missing", async () => {
  const result = await checkActiveDataWriters({});
  assert.equal(result.busy, true);
  assert.match(result.message, /missing GitHub repository or token/);
});
