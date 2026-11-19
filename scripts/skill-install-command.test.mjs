import assert from "node:assert/strict";
import test from "node:test";
import { isDeprecatedSkill, manualInstallCommand } from "./skill-install-command.mjs";

const sha = "7d3ed49e3a36b85f30e88d4d9ec75f9b6ee44604";
const nested = {
  name: "bug-triage",
  github_url: "https://github.com/apify/apify-mcp-server",
  skill_md_path: ".claude/skills/bug-triage/SKILL.md",
  repo_commit_sha: sha,
  install_cmd: "git clone https://github.com/apify/apify-mcp-server /tmp/apify-mcp-server && ln -s /tmp/apify-mcp-server/.claude/skills/bug-triage ~/.claude/skills/bug-triage",
};

test("copies the skill folder at the pinned commit into ~/.claude/skills, replacing an old link", () => {
  const command = manualInstallCommand(nested);
  assert.equal(command, `tmp="$(mktemp -d)" && { git clone -q --filter=blob:none --no-checkout https://github.com/apify/apify-mcp-server "$tmp" && git -C "$tmp" checkout -q ${sha} && { [ ! -L ~/.claude/skills/bug-triage ] || rm ~/.claude/skills/bug-triage; } && mkdir -p ~/.claude/skills/bug-triage && cp -R "$tmp/.claude/skills/bug-triage/." ~/.claude/skills/bug-triage/; ok=$?; rm -rf "$tmp"; [ "$ok" = 0 ]; }`);
  assert.doesNotMatch(command, /\/tmp\/|ln -s/);
});

test("a root skill copies the repo; no pin means the latest commit", () => {
  const command = manualInstallCommand({ name: "pdf", github_url: "https://github.com/a/pdf", skill_md_path: "SKILL.md" });
  assert.match(command, /git clone -q --depth 1 https:\/\/github\.com\/a\/pdf "\$tmp" && /);
  assert.match(command, /cp -R "\$tmp\/\." ~\/\.claude\/skills\/pdf\//);
});

test("the folder name is the catalog's install target, then the old command's, then the skill name", () => {
  assert.match(manualInstallCommand({ ...nested, install_target_name: "triage" }), /~\/\.claude\/skills\/triage\//);
  // A namespaced target ("pinecone:assistant") isn't a plain name; the next one is used.
  assert.match(manualInstallCommand({ ...nested, install_target_name: "pinecone:assistant", install_cmd: "", name: "assistant" }), /skills\/assistant\//);
  assert.match(manualInstallCommand({ ...nested, skill_md_path: "skills/文档/SKILL.md" }), /"\$tmp\/skills\/文档\/\."/);
});

test("unsafe or missing parts fall back to the catalog's command unless it uses /tmp", () => {
  assert.equal(manualInstallCommand({ ...nested, github_url: "https://gitlab.com/a/b" }), "");
  assert.equal(manualInstallCommand({ ...nested, skill_md_path: "../x/SKILL.md" }), "");
  assert.equal(manualInstallCommand({ ...nested, skill_md_path: "a b/SKILL.md" }), "");
  assert.equal(manualInstallCommand({ ...nested, install_cmd: "", name: "my skill; rm" }), "");
  const root = "git clone https://github.com/a/b ~/.claude/skills/b";
  assert.equal(manualInstallCommand({ ...nested, skill_md_path: "", install_cmd: root }), root);
});

test("deprecated skills are the ones whose description says so first", () => {
  assert.equal(isDeprecatedSkill({ description: "Deprecated." }), true);
  assert.equal(isDeprecatedSkill({ description: "DEPRECATED: use apify-actor instead" }), true);
  assert.equal(isDeprecatedSkill({ description: "[Deprecated] old" }), true);
  assert.equal(isDeprecatedSkill({ description: "Finds deprecated APIs in your code" }), false);
});
