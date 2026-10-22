import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { waitForFirewallApproval } from "./wait-for-deploy-firewall-approval.mjs";

const workflow = await readFile(new URL("../.github/workflows/deploy-current-main.yml", import.meta.url), "utf8");
const wrapper = await readFile(new URL("./deploy-current-main-prod.sh", import.meta.url), "utf8");

test("recovery deploy is manual, serialized, and pinned to reviewed main", () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*?expected_sha:/);
  assert.match(workflow, /group: app-data-writers/);
  assert.match(workflow, /git reset --hard origin\/main/);
  assert.match(workflow, /git rev-parse HEAD[\s\S]*?EXPECTED_SHA/);
  assert.doesNotMatch(workflow, /git push|git tag/);
});

test("recovery deploy restores health, builds the combined site, and uploads its receipt", () => {
  const restore = workflow.indexOf("Restore latest health snapshot");
  const prepare = workflow.indexOf("Prepare release assets for Netlify deploy");
  const build = workflow.indexOf("npm run build:netlify");
  const deploy = workflow.indexOf("npm run deploy:production");
  assert.ok(restore !== -1 && restore < prepare);
  assert.ok(prepare < build && build < deploy);
  assert.match(workflow, /dist\/netlify-deploy-receipt\.json/);
  assert.match(workflow, /Confirm public appcast is unchanged/);
});

test("firewall hold runs in the deployment job before any draft or production upload", () => {
  const build = workflow.indexOf("npm run build:netlify");
  const hold = workflow.indexOf("node ./scripts/wait-for-deploy-firewall-approval.mjs");
  const deploy = workflow.indexOf("npm run deploy:production");
  assert.ok(build < hold && hold < deploy);
  assert.equal((workflow.match(/runs-on:/g) || []).length, 1);
  assert.match(workflow, /if: always\(\) && steps\.firewall_approval\.outputs\.issue_url/);
  assert.match(workflow, /Remove this run/);
});

test("local dispatcher requires a clean checkout exactly at origin main", () => {
  assert.match(wrapper, /git status --porcelain/);
  assert.match(wrapper, /git fetch origin main/);
  assert.match(wrapper, /expected_sha[\s\S]*?origin_sha/);
  assert.match(wrapper, /git remote get-url origin/);
  assert.doesNotMatch(wrapper, /gh repo view/);
  assert.match(wrapper, /gh workflow run deploy-current-main\.yml/);
  assert.match(wrapper, /gh run watch/);
  assert.doesNotMatch(wrapper, /netlify|git push|git tag/);
});

const approvalEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
  EXPECTED_SHA: "a".repeat(40), GITHUB_ACTOR: "owner", GITHUB_TOKEN: "test-only",
};
const approval = `approve-firewall 123/2 ${approvalEnv.EXPECTED_SHA} 203.0.113.1`;

function approvalFixture(comments = [], getPublicIps = async () => ["203.0.113.1"]) {
  let time = 0;
  const calls = [];
  const options = {
    env: approvalEnv, getPublicIps, timeoutMs: 100, pollMs: 50, now: () => time,
    sleep: async ms => { time += ms; },
    report: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => init.method === "POST"
        ? { number: 7, html_url: "https://github.com/owner/repo/issues/7" }
        : comments };
    },
  };
  return { options, calls };
}

test("only the exact actor, run, attempt, commit and IP approval resumes the hold", async () => {
  const f = approvalFixture([{ id: 1, user: { login: "OWNER" }, body: approval }]);
  assert.equal((await waitForFirewallApproval(f.options)).approvalCommentId, 1);
  assert.equal(f.calls[0].init.method, "POST");
  assert.match(JSON.parse(f.calls[0].init.body).body, /203\.0\.113\.1\/32/);
  for (const comment of [
    { user: { login: "stranger" }, body: approval },
    { user: { login: "owner" }, body: approval.replace("123/2", "123/1") },
    { user: { login: "owner" }, body: approval.replace(approvalEnv.EXPECTED_SHA, "b".repeat(40)) },
    { user: { login: "owner" }, body: approval.replace("203.0.113.1", "203.0.113.2") },
  ]) {
    await assert.rejects(waitForFirewallApproval(approvalFixture([comment]).options), /timed out/);
  }
});

test("no approval, invalid context, or an IP change stops without deploying", async () => {
  await assert.rejects(waitForFirewallApproval(approvalFixture().options), /timed out/);
  const f = approvalFixture();
  await assert.rejects(waitForFirewallApproval({ ...f.options, env: { ...approvalEnv, GITHUB_REF: "refs/heads/other" } }), /pinned manual/);
  assert.equal(f.calls.length, 0);
  let reads = 0;
  const changed = approvalFixture([{ user: { login: "owner" }, body: approval }],
    async () => [++reads === 1 ? "203.0.113.1" : "203.0.113.2"]);
  await assert.rejects(waitForFirewallApproval(changed.options), /IP changed/);
  assert(changed.calls.every(call => call.url.startsWith("https://api.github.com/repos/owner/repo/")));
});
