import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installCommandFor, isMacDevice } from "../src/app/unified/install-command";

const commit = "a".repeat(40);

test("MCP API pins remain pinned when raw catalog-only fields are absent", () => {
  const command = installCommandFor({
    github_url: "https://github.com/example/skills",
    skill_md_path: "skills/review/SKILL.md",
    install_status: "pinned",
    pinned_install: { repo: "example/skills", path: "skills/review", commit_sha: commit, skill_md_sha: "b".repeat(40) },
  })!;
  assert.ok(command);
  assert.ok(command.includes(`fetch -q --depth 1 'https://github.com/example/skills' ${commit}`));
  assert.doesNotMatch(command, /git clone/);
});

test("malformed or missing advertised pins never fall back to the default branch", () => {
  const source = { github_url: "https://github.com/example/skills", skill_md_path: "skills/review/SKILL.md" };
  for (const pinned_install of [{}, { commit_sha: "main" }, { commit_sha: "" }, [], "bad"]) {
    assert.equal(installCommandFor({ ...source, pinned_install }), undefined);
  }
  assert.equal(installCommandFor({ ...source, install_status: "pinned" }), undefined);
  assert.equal(installCommandFor({ ...source, repo_commit_sha: "not-a-commit" }), undefined);
});

test("pinned skills fetch their commit and move only the skill folder", () => {
  const command = installCommandFor({ github_url: "https://github.com/example/skills", skill_md_path: "skills/review/SKILL.md", repo_commit_sha: commit, install_target_name: "review" })!;
  assert.match(command, /^test ! -e ~\/\.claude\/skills\/'review' && d=\$\(mktemp -d\) && /);
  assert.match(command, new RegExp(`fetch -q --depth 1 'https://github.com/example/skills' ${commit}`));
  assert.match(command, /mv "\$d"\/'skills\/review' ~\/\.claude\/skills\/'review' && rm -rf "\$d"$/);
  assert.doesNotMatch(command, /\/tmp\/|ln -s/);
});

test("unpinned and root skills clone the default branch and keep the folder name", () => {
  const command = installCommandFor({ github_url: "https://github.com/example/solo.git", skill_md_path: "SKILL.md" })!;
  assert.match(command, /git clone -q --depth 1 'https:\/\/github.com\/example\/solo' "\$d"/);
  assert.match(command, /rm -rf "\$d\/\.git" && mv "\$d" ~\/\.claude\/skills\/'solo'/);
});

test("catalog text is quoted and unsafe values give no command", () => {
  const command = installCommandFor({ github_url: "https://github.com/example/skills", skill_md_path: "a b/it's $(x)/SKILL.md", install_target_name: "ok" })!;
  assert.match(command, /'a b\/it'\\''s \$\(x\)'/);
  for (const skill of [
    { github_url: "https://evil.example/x/y", skill_md_path: "SKILL.md" },
    { github_url: "https://github.com/x/y", skill_md_path: "../SKILL.md" },
    { github_url: "https://github.com/x/y", skill_md_path: "README.md" },
    { github_url: "https://github.com/x/y", skill_md_path: "SKILL.md", install_target_name: "../escape" },
    { github_url: "https://github.com/x/y" },
  ]) assert.equal(installCommandFor(skill), undefined, JSON.stringify(skill));
});

test("the command installs a skill folder from a local repository and refuses to overwrite", (t) => {
  try { execFileSync("git", ["--version"]); } catch { t.skip("git unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "install-command-"));
  try {
    const repo = join(root, "repo"), home = join(root, "home");
    mkdirSync(join(repo, "skills", "review"), { recursive: true });
    mkdirSync(home);
    writeFileSync(join(repo, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: d\n---\n");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env }).toString().trim();
    execFileSync("git", ["init", "-q", repo], { env });
    git("add", ".");
    git("commit", "-qm", "init");
    const pinnedCommit = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "skills", "review", "SKILL.md"), "Default branch content must not be installed.\n");
    git("add", ".");
    git("commit", "-qm", "change default branch");
    const command = installCommandFor({ github_url: "https://github.com/example/skills", skill_md_path: "skills/review/SKILL.md",
      install_status: "pinned", pinned_install: { repo: "example/skills", path: "skills/review", commit_sha: pinnedCommit,
        skill_md_sha: "b".repeat(40) } })!
      .replace("'https://github.com/example/skills'", `'${repo}'`);
    const run = () => execFileSync("sh", ["-c", command], { env: { ...env, HOME: home }, stdio: "pipe" });
    run();
    assert.match(readFileSync(join(home, ".claude", "skills", "review", "SKILL.md"), "utf8"), /name: review/);
    assert.equal(existsSync(join(home, ".claude", "skills", "review", ".git")), false);
    assert.throws(run, "an existing skill is never overwritten");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only Mac desktops count as Macs", () => {
  assert.equal(isMacDevice({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 0 }), true);
  assert.equal(isMacDevice({ userAgentData: { platform: "macOS" }, userAgent: "" }), true);
  assert.equal(isMacDevice({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 }), false);
  assert.equal(isMacDevice({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), false);
  assert.equal(isMacDevice({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux)" }), false);
  assert.equal(isMacDevice({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS)" }), false);
});
