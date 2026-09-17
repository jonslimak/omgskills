import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import {
  createPinnedPackageMetadataResolver,
  packageRootFromSkillPath,
  preserveLastGoodPinnedSkill,
  validatePinnedPackageMetadata,
} from "./package-metadata.js";

const sha = (character: string) => character.repeat(40);

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "old-owner/repo:example",
    name: "example",
    description: "Example skill",
    github_url: "https://github.com/old-owner/repo",
    skill_md_path: "skills/example/SKILL.md",
    install_cmd: "git clone https://github.com/old-owner/repo /tmp/repo && ln -s /tmp/repo/skills/example ~/.claude/skills/example",
    author_handle: "old-owner",
    tags: [],
    stars: 1,
    last_updated: "2026-09-17T00:00:00Z",
    first_seen: "2026-09-17",
    skill_md_sha: sha("a"),
    ...overrides,
  };
}

function fakeClient(options: { truncated?: boolean; root?: boolean } = {}) {
  const calls: string[] = [];
  const rootTree = sha("c");
  const packageTree = sha("d");
  const skillsTree = sha("e");
  const tree = options.root
    ? [{ path: "SKILL.md", type: "blob", sha: sha("a") }]
    : [
        { path: "skills", type: "tree", sha: skillsTree },
        { path: "skills/example", type: "tree", sha: packageTree },
        { path: "skills/example/SKILL.md", type: "blob", sha: sha("a") },
      ];
  return {
    calls,
    client: {
      rest: {
        repos: {
          get: async () => {
            calls.push("repo");
            return { data: { full_name: "canonical-owner/repo", default_branch: "main" } };
          },
          getCommit: async () => {
            calls.push("commit");
            return { data: { sha: sha("b"), commit: { tree: { sha: rootTree } } } };
          },
        },
        git: {
          getTree: async ({ tree_sha, recursive }: { tree_sha: string; recursive?: "true" }) => {
            calls.push(`tree:${tree_sha}:${recursive ?? "direct"}`);
            if (recursive) return { data: { truncated: options.truncated === true, tree } };
            if (tree_sha === rootTree) {
              return { data: { tree: options.root ? tree : [{ path: "skills", type: "tree", sha: skillsTree }] } };
            }
            if (tree_sha === skillsTree) return { data: { tree: [{ path: "example", type: "tree", sha: packageTree }] } };
            if (tree_sha === packageTree) return { data: { tree: [{ path: "SKILL.md", type: "blob", sha: sha("a") }] } };
            return { data: { tree: [] } };
          },
        },
      },
    },
  };
}

test("maps root and nested skill paths to package roots", () => {
  assert.equal(packageRootFromSkillPath("SKILL.md"), ".");
  assert.equal(packageRootFromSkillPath("skills/example/SKILL.md"), "skills/example");
  assert.equal(packageRootFromSkillPath("README.md"), null);
});

test("pinned package coordinates are atomic", () => {
  assert.deepEqual(validatePinnedPackageMetadata(skill()), []);
  const errors = validatePinnedPackageMetadata({ ...skill(), repo_slug: "owner/repo" });
  assert.match(errors.join(" "), /missing atomic fields/);
});

test("metadata failure preserves the complete last-good skill record", () => {
  const existing = skill({
    repo_slug: "old-owner/repo",
    repo_commit_sha: sha("b"),
    skill_tree_sha: sha("c"),
    install_target_name: "example",
  });
  const next = skill({ description: "Changed", skill_md_sha: sha("d") });
  assert.equal(preserveLastGoodPinnedSkill(next, existing), existing);
  assert.equal(preserveLastGoodPinnedSkill(next, undefined), next);
});

test("resolves nested package metadata and canonical repository identity", async () => {
  const fake = fakeClient();
  const resolve = createPinnedPackageMetadataResolver(fake.client);
  const result = await resolve(skill());

  assert.deepEqual(result, {
    repo_slug: "canonical-owner/repo",
    skill_md_path: "skills/example/SKILL.md",
    repo_commit_sha: sha("b"),
    skill_tree_sha: sha("d"),
    skill_md_sha: sha("a"),
    install_target_name: "example",
  });
});

test("resolves root skill package metadata", async () => {
  const fake = fakeClient({ root: true });
  const resolve = createPinnedPackageMetadataResolver(fake.client);
  const result = await resolve(skill({ skill_md_path: "SKILL.md" }));
  assert.equal(result?.skill_tree_sha, sha("c"));
});

test("truncated recursive trees use targeted traversal for a known path", async () => {
  const fake = fakeClient({ truncated: true });
  const resolve = createPinnedPackageMetadataResolver(fake.client);
  const result = await resolve(skill());

  assert.equal(result?.skill_tree_sha, sha("d"));
  assert.ok(fake.calls.some((call) => call.endsWith(":direct")));
});

test("truncated recursive trees never guess a missing path", async () => {
  const fake = fakeClient({ truncated: true });
  const resolve = createPinnedPackageMetadataResolver(fake.client);
  const result = await resolve(skill({ skill_md_path: undefined }));
  assert.equal(result, null);
});

test("repository snapshot is reused for multiple skills", async () => {
  const fake = fakeClient();
  const resolve = createPinnedPackageMetadataResolver(fake.client);
  await resolve(skill());
  await resolve(skill({ id: "old-owner/repo:other" }));

  assert.equal(fake.calls.filter((call) => call === "repo").length, 1);
  assert.equal(fake.calls.filter((call) => call === "commit").length, 1);
});

test("shared root, nested, and legacy compatibility fixtures validate", () => {
  const fixtures = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pinned-install-skills.json"), "utf8"),
  ) as Skill[];
  assert.equal(fixtures.length, 3);
  assert.deepEqual(fixtures.map(validatePinnedPackageMetadata), [[], [], []]);
});
