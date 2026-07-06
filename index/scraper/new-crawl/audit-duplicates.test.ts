import test from "node:test";
import assert from "node:assert/strict";
import { buildDuplicateAudit, type DuplicateAuditSkill } from "./audit-duplicates.js";

function skill(overrides: Partial<DuplicateAuditSkill> & Pick<DuplicateAuditSkill, "id">): DuplicateAuditSkill {
  const { id, ...rest } = overrides;
  return {
    id,
    name: "Skill",
    github_url: "https://github.com/owner/repo",
    install_cmd: "install one",
    author_handle: "owner",
    tags: [],
    stars: 0,
    last_updated: "2026-05-22T00:00:00Z",
    first_seen: "2026-05-22",
    skill_md_sha: "sha-one",
    provenance_type: "original",
    ...rest,
  } as DuplicateAuditSkill;
}

function category(audit: ReturnType<typeof buildDuplicateAudit>, name: string) {
  const result = audit.categories.find((row) => row.category === name);
  assert.ok(result);
  return result;
}

test("groups same SHA duplicates and ignores missing SHA", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", skill_md_sha: "same" }),
    skill({ id: "b/repo:two", skill_md_sha: "same" }),
    skill({ id: "c/repo:missing", skill_md_sha: "" }),
  ]);
  const result = category(audit, "skill_md_sha");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.affectedSkillCount, 2);
  assert.equal(result.clusters[0]?.key, "same");
});

test("groups same author and normalized name duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", author_handle: "Owner", name: "  My   Skill " }),
    skill({ id: "a/repo:two", author_handle: "owner", name: "my skill" }),
    skill({ id: "b/repo:three", author_handle: "other", name: "my skill" }),
  ]);
  const result = category(audit, "author_name");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "owner\tmy skill");
});

test("groups same repo and normalized name duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "owner/repo:one", github_url: "https://github.com/Owner/Repo", name: "Deploy Skill" }),
    skill({ id: "owner/repo:two", github_url: "https://github.com/owner/repo?tab=readme", name: "deploy   skill" }),
    skill({ id: "owner/other:three", github_url: "https://github.com/owner/other", name: "deploy skill" }),
  ]);
  const result = category(audit, "repo_name");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "owner/repo\tdeploy skill");
});

test("groups normalized install command duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", install_cmd: "npm   install   a" }),
    skill({ id: "b/repo:two", install_cmd: "npm install a" }),
    skill({ id: "c/repo:three", install_cmd: "npm install b" }),
  ]);
  const result = category(audit, "install_cmd");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "npm install a");
});

test("cluster output is deterministic", () => {
  const input = [
    skill({ id: "z/repo:low", skill_md_sha: "same", stars: 1 }),
    skill({ id: "a/repo:high", skill_md_sha: "same", stars: 10 }),
    skill({ id: "m/repo:mid", skill_md_sha: "same", stars: 10 }),
  ];
  const first = buildDuplicateAudit(input);
  const second = buildDuplicateAudit([...input].reverse());

  assert.deepEqual(first, second);
  assert.deepEqual(
    category(first, "skill_md_sha").clusters[0]?.samples.map((row) => row.id),
    ["a/repo:high", "m/repo:mid", "z/repo:low"],
  );
});
