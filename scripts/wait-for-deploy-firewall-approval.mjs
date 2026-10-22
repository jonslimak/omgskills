import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const WAIT_MS = 15 * 60 * 1000;

async function readPublicIps() {
  const curl = async (family, host) => {
    const { stdout } = await exec("curl", [
      `-${family}`, "--fail", "--silent", "--show-error",
      "--connect-timeout", "10", "--max-time", "15", `https://${host}`,
    ]);
    const ip = stdout.trim();
    if (isIP(ip) !== family) throw new Error(`Invalid IPv${family} egress address`);
    return ip;
  };
  const ipv4 = await curl(4, "api.ipify.org");
  // GitHub-hosted runners may not have an IPv6 route. Draft verification still
  // fails closed if its actual outbound address is not in the exception list.
  const ipv6 = await curl(6, "api6.ipify.org").catch(() => null);
  return [ipv4, ipv6].filter(Boolean).sort();
}

function checkedIps(ips) {
  if (!Array.isArray(ips) || !ips.length || ips.some(ip => !isIP(ip))) {
    throw new Error("Missing or invalid runner public IPs");
  }
  return [...new Set(ips)].sort();
}

async function reportApproval({ issue, body, env }) {
  const text = `## Firewall approval required\n\n${body}\n\nApproval issue: ${issue.html_url}\n`;
  console.log(text);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `issue_url=${issue.html_url}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, text);
}

export async function waitForFirewallApproval({
  env = process.env,
  fetchImpl = fetch,
  getPublicIps = readPublicIps,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  now = Date.now,
  timeoutMs = WAIT_MS,
  pollMs = 10_000,
  report = reportApproval,
} = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  const sha = env.EXPECTED_SHA;
  const actor = env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR;
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")
    || !/^\d+$/.test(runId ?? "") || !/^\d+$/.test(attempt ?? "")
    || !/^[a-f0-9]{40}$/.test(sha ?? "") || !/^[\w-]+$/.test(actor ?? "")
    || !env.GITHUB_TOKEN) {
    throw new Error("Firewall approval requires a pinned manual main-branch GitHub run");
  }
  const api = async (path, method = "GET", body) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Firewall approval GitHub request failed: ${response.status}`);
    return response.json();
  };
  const ips = checkedIps(await getPublicIps());
  const approval = `approve-firewall ${runId}/${attempt} ${sha} ${ips.join(",")}`;
  const body = [
    `Run: https://github.com/${repository}/actions/runs/${runId} (attempt ${attempt})`,
    `Reviewed commit: \`${sha}\``,
    `Runner-only IP exceptions: ${ips.map(ip => `\`${ip}/${isIP(ip) === 4 ? 32 : 128}\``).join(", ")}`,
    "",
    "Before approval: save the previous settings; keep published deploys public; block unpublished deploys with ONLY these temporary IP exceptions; verify old APIs are blocked from another IP and the live site works; allow existing requests to finish before migrations.",
    "The exception also permits this runner to access old deploys. It does not bypass application authentication. No Netlify setting is changed by this script.",
    "",
    `Only @${actor} can resume this same job by posting this exact comment within 15 minutes:`,
    "```text", approval, "```",
    "",
    "After success, failure, timeout or cancellation: remove these temporary exceptions, keep unpublished deploys blocked, and record cleanup here. Nothing expires automatically. Do not close this issue until cleanup is confirmed.",
  ].join("\n");
  const issue = await api("/issues", "POST", {
    title: `Deployment firewall approval ${runId}/${attempt}`, body,
  });
  if (!Number.isSafeInteger(issue.number) || issue.number <= 0) {
    throw new Error("GitHub did not return an approval issue number");
  }
  await report({ issue, body, env });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    for (let page = 1; page <= 10; page++) {
      const comments = await api(`/issues/${issue.number}/comments?per_page=100&page=${page}`);
      if (now() >= deadline) break;
      const accepted = comments.find(comment =>
        comment.user?.login?.toLowerCase() === actor.toLowerCase()
        && comment.body?.trim() === approval);
      if (accepted) {
        const currentIps = checkedIps(await getPublicIps());
        if (JSON.stringify(currentIps) !== JSON.stringify(ips)) {
          throw new Error("Runner IP changed after approval; stop and remove the old exceptions");
        }
        if (now() >= deadline) break;
        console.log(`Firewall approval received from @${actor}; continuing on the same runner.`);
        return { issueUrl: issue.html_url, ips, approvalCommentId: accepted.id };
      }
      if (comments.length < 100) break;
      if (page === 10) throw new Error("Too many approval comments; refusing to resume");
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Firewall approval timed out; no deployment started. Remove temporary IP exceptions: ${issue.html_url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  waitForFirewallApproval().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
