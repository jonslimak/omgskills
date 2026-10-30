import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/shadow-crawl-health.yml", import.meta.url),
  "utf8",
);

test("shadow crawl stages generated data directories instead of optional asset globs", () => {
  assert.match(workflow, /git add -A -- site\/data\/v2 site\/data\/crawl4/);
  assert.doesNotMatch(workflow, /git add -A --[^\n]*\*\.json/);
});

test("published app data is mirrored to R2 before it is committed", () => {
  const upload = workflow.indexOf("      - name: Upload catalog data to R2");
  const step = workflow.slice(upload, workflow.indexOf("\n      - name:", upload + 1));
  assert.ok(upload > workflow.indexOf("      - name: Check publication impact"), "upload follows the impact check");
  assert.ok(upload < workflow.indexOf("      - name: Commit if changed"), "upload precedes the commit");
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /node \.\/scripts\/data-store\.mjs push --dir site\/data\/v2 --dir site\/data\/crawl4/);
  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    assert.match(step, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
});

test("the commit step includes new and changed asset lists even without catalog changes", async () => {
  const step = workflow.match(/      - name: Commit if changed\n        run: \|\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(step, "commit step missing");
  const script = step.replace(/^          /gm, "");
  const dir = await mkdtemp(path.join(tmpdir(), "shadow-assets-commit-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  // Only transport is stubbed; the real workflow stages and commits a temporary repository.
  const run = () => execFileSync("bash", ["-e", "-c", `git() { case "$1" in pull|push) return 0 ;; *) command git "$@" ;; esac; }\n${script}`], { cwd: dir, env });
  try {
    for (const folder of ["index/snapshots", "site/data/v2", "site/data/crawl4"]) await mkdir(path.join(dir, folder), { recursive: true });
    for (const file of ["skills", "trending", "trending-leaderboard", "leaderboard-view-data", "skill-signals", "author-signals", "author-leaderboards"]) {
      await writeFile(path.join(dir, "index", `${file}.json`), "[]\n");
    }
    await writeFile(path.join(dir, "index/snapshots/.keep"), "");
    for (const track of ["v2", "crawl4"]) await writeFile(path.join(dir, `site/data/${track}/manifest.json`), "{}\n");
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    git("add", ".");
    git("commit", "-qm", "Baseline");
    const before = git("rev-parse", "HEAD");
    for (const track of ["v2", "crawl4"]) await writeFile(path.join(dir, `site/data/${track}/assets.txt`), "skills-000000000000.json\n");
    run();
    const created = git("rev-parse", "HEAD");
    assert.notEqual(created, before, "new untracked lists must produce a commit");
    assert.deepEqual(git("show", "--format=", "--name-only", "HEAD").split("\n"), ["site/data/crawl4/assets.txt", "site/data/v2/assets.txt"]);
    run();
    assert.equal(git("rev-parse", "HEAD"), created, "unchanged lists must not create an empty commit");
    await writeFile(path.join(dir, "site/data/v2/assets.txt"), "skills-111111111111.json\n");
    run();
    assert.notEqual(git("rev-parse", "HEAD"), created, "changed lists must produce a commit");
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skill equivalence publication and impact verification share one explicit mode", () => {
  const writerJob = workflow.match(
    /  shadow-crawl-health:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|\s*$)/,
  )?.[0];

  assert.ok(writerJob, "shadow-crawl-health job missing");
  assert.match(writerJob, /env:\n      # Keep publish and final impact verification[\s\S]*?SKILL_EQUIVALENCE_PUBLISH: "1"/);
  assert.equal(workflow.match(/SKILL_EQUIVALENCE_PUBLISH:/g)?.length, 1);
});

test("canonical SHA publication is enabled only for its publisher step", () => {
  const step = workflow.match(
    /      - name: Publish SHA history\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];

  assert.ok(step, "Publish SHA history step missing");
  assert.match(step, /SHA_CANONICAL_PUBLISH: "1"/);
  assert.equal(workflow.match(/SHA_CANONICAL_PUBLISH:/g)?.length, 1);
});

test("production enforces admission while report-only keeps observing", () => {
  const reportOnlyStep = workflow.match(
    /      - name: Run report-only shadow crawl\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  const writerStep = workflow.match(
    /      - name: Run shadow crawl\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];

  assert.ok(reportOnlyStep, "report-only shadow crawl step missing");
  assert.ok(writerStep, "production shadow crawl step missing");
  assert.match(reportOnlyStep, /CRAWL4_POLICY_PRECEDENCE: "observe"/);
  assert.match(writerStep, /CRAWL4_POLICY_PRECEDENCE: "admission"/);
  assert.match(reportOnlyStep, /CRAWL4_QUALITY_TIERS: "1"/);
  assert.match(writerStep, /CRAWL4_QUALITY_TIERS: "1"/);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE:/g)?.length, 2);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE: "observe"/g)?.length, 1);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE: "admission"/g)?.length, 1);
  assert.match(workflow, /Upload policy precedence observation/);
  assert.match(workflow, /Upload report-only policy precedence observation/);
  assert.match(workflow, /policy-precedence\.shadow\.json/);
  assert.match(workflow, /policy-precedence\.shadow\.md/);
  assert.doesNotMatch(workflow, /CRAWL4_POLICY_PRECEDENCE: "enforce"/);
});

test("report-only dispatch cannot enter the production writer job", () => {
  assert.match(workflow, /report_only:\n[\s\S]*?default: true\n[\s\S]*?type: boolean/);
  assert.match(
    workflow,
    /policy-precedence-report-only:\n    if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.report_only == true \}\}/,
  );
  assert.match(
    workflow,
    /policy-precedence-report-only:[\s\S]*?permissions:\n      contents: read/,
  );
  assert.match(
    workflow,
    /shadow-crawl-health:\n    if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.report_only != true \}\}/,
  );
});

test("creator coverage maintenance is bounded, weekly, manual, and stays inside the writer job", () => {
  const writerJob = workflow.match(
    /  shadow-crawl-health:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|\s*$)/,
  )?.[0];

  assert.ok(writerJob, "shadow-crawl-health job missing");
  assert.match(workflow, /creator_coverage:\n[\s\S]*?default: false\n[\s\S]*?type: boolean/);
  assert.match(workflow, /creator_handles:\n[\s\S]*?required: false\n[\s\S]*?type: string/);
  assert.match(writerJob, /EVENT_SCHEDULE: \$\{\{ github\.event\.schedule \|\| '' \}\}/);
  assert.match(writerJob, /\[ "\$EVENT_SCHEDULE" = "0 6 \* \* \*" \].*\[ "\$\(date -u \+%u\)" = "7" \]/);
  assert.match(writerJob, /MANUAL_CREATOR_COVERAGE: \$\{\{ inputs\.creator_coverage == true && '1' \|\| '0' \}\}/);
  assert.match(writerJob, /npm run scrape:shadow -- --cadence=fast/);
  assert.match(writerJob, /args=\(--maintain --limit=125\)/);
  assert.match(writerJob, /args\+=\("--creators=\$CREATOR_HANDLES"\)/);
  assert.match(writerJob, /npm run crawl4:creator-backfill -- "\$\{args\[@\]\}"/);
  assert.match(writerJob, /name: Run creator coverage maintenance[\s\S]*?name: Run shadow guard tests/);
  assert.match(writerJob, /name: Upload creator coverage maintenance report/);
});
