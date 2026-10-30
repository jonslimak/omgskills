import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installAgents, installScript, type InstallAgent, type PinnedInstall } from "../src/install.js";

const pin: PinnedInstall = { repo: "owner/repo", path: "skills/example", commit_sha: "a".repeat(40), skill_md_sha: "b".repeat(40) };

async function fixture(context: { after: (fn: () => unknown) => void }, mode = "success", scope: "user" | "project" = "project", agent: InstallAgent = "codex") {
  const root = await mkdtemp(join(tmpdir(), "mcp-install-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project with spaces"), home = join(root, "home with spaces"), scratch = join(root, "scratch"), bin = join(root, "bin");
  for (const path of [cwd, home, scratch, bin]) await mkdir(path);
  const destination = join(scope === "user" ? home : cwd, `.${agent === "claude_code" ? "claude" : agent}/skills/example`);
  await writeFile(join(bin, "git"), `#!/bin/sh
set -e
work="$2"
case "$3" in
  fetch)
    if [ "$MODE" = fetch-fail ]; then exit 23; fi
    if [ "$MODE" = race ]; then mkdir -p "$DESTINATION"; printf original > "$DESTINATION/sentinel"; fi ;;
  checkout)
    if [ "$MODE" = signal ]; then kill -TERM "$PPID"; exit 0; fi
    if [ "$MODE" = checkout-fail ]; then exit 24; fi
    mkdir -p "$work/skills/example/nested"
    printf skill > "$work/skills/example/SKILL.md"
    printf payload > "$work/skills/example/nested/resource.txt" ;;
  rev-parse)
    if [ "$MODE" = hash-fail ]; then printf wrong; else printf '${pin.skill_md_sha}'; fi ;;
esac
`, { mode: 0o700 });
  await writeFile(join(bin, "cp"), `#!/bin/sh
if [ "$MODE" = copy-fail ]; then printf partial > "$DESTINATION/partial"; exit 25; fi
exec /bin/cp "$@"
`, { mode: 0o700 });
  const run = () => spawnSync("/bin/sh", ["-c", installScript(pin, "example", agent, scope).script], {
    cwd, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: scratch, MODE: mode, DESTINATION: destination }, encoding: "utf8"
  });
  return { destination, scratch, run };
}

for (const agent of installAgents) for (const scope of ["user", "project"] as const) test(`successful ${agent} ${scope} installation handles spaces and cleans scratch files`, async context => {
  const f = await fixture(context, "success", scope, agent);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(f.destination, "SKILL.md"), "utf8"), "skill");
  assert.equal(await readFile(join(f.destination, "nested/resource.txt"), "utf8"), "payload");
  assert.deepEqual((await readdir(f.destination)).sort(), ["SKILL.md", "nested"]);
  assert.deepEqual(await readdir(f.scratch), []);
});

for (const [mode, status] of [["fetch-fail", 23], ["checkout-fail", 24], ["hash-fail", 1], ["copy-fail", 25], ["signal", 143]] as const) test(`${mode} cleans temporary and partial files`, async context => {
  const f = await fixture(context, mode);
  assert.equal(f.run().status, status);
  assert.deepEqual(await readdir(f.scratch), []);
  await assert.rejects(lstat(f.destination), { code: "ENOENT" });
});

for (const agent of installAgents) for (const kind of ["directory", "file", "dangling-symlink"] as const) test(`${agent} preserves an existing ${kind}`, async context => {
  const f = await fixture(context, "success", "project", agent);
  await mkdir(join(f.destination, ".."), { recursive: true });
  if (kind === "directory") { await mkdir(f.destination); await writeFile(join(f.destination, "sentinel"), "original"); }
  else if (kind === "file") await writeFile(f.destination, "original");
  else await symlink("missing-target", f.destination);
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readdir(f.scratch), []);
  if (kind === "dangling-symlink") assert.equal((await lstat(f.destination)).isSymbolicLink(), true);
  else assert.equal(await readFile(kind === "directory" ? join(f.destination, "sentinel") : f.destination, "utf8"), "original");
});

test("does not copy into a destination created while fetching", async context => {
  const f = await fixture(context, "race");
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readdir(f.destination), ["sentinel"]);
  assert.equal(await readFile(join(f.destination, "sentinel"), "utf8"), "original");
  assert.deepEqual(await readdir(f.scratch), []);
});
