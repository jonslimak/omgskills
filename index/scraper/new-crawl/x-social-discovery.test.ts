import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildXSocialDiscoveryCandidates, loadXSocialDiscoveryCandidates } from "./x-social-discovery.js";

test("missing X artifact skips cleanly", () => {
  const result = loadXSocialDiscoveryCandidates(join(tmpdir(), "missing-top-x-skill-tweets.json"));

  assert.deepEqual(result.candidates, []);
  assert.equal(result.skippedCount, 0);
  assert.match(result.warning ?? "", /x-social discovery skipped/);
});

test("valid X repo becomes x-social bootstrap candidate", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "Owner/Repo",
          github_url: "https://github.com/Owner/Repo",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo skill",
          stars: 42,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.repo, "owner/repo");
  assert.equal(result.candidates[0]?.candidate.source, "x-social");
  assert.equal(result.candidates[0]?.candidate.id, "owner/repo:demo");
  assert.equal(result.candidates[0]?.candidate.skill_md_path, "skills/demo/SKILL.md");
  assert.equal(result.candidates[0]?.stars, 42);
});

test("X repos without usable paths are skipped", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "owner/repo",
          github_url: "https://github.com/owner/repo",
          skill_md_path: "__RESOLVE__",
          name: "Resolve",
          description: "Resolve",
          stars: 1,
        },
        {
          id: "owner/no-path",
          github_url: "https://github.com/owner/no-path",
          name: "No path",
          description: "No path",
          stars: 1,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedCount, 2);
});

test("X duplicate repo path rows collapse deterministically", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "owner/repo",
          github_url: "https://github.com/owner/repo",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo",
          stars: 1,
        },
        {
          id: "OWNER/REPO",
          github_url: "https://github.com/OWNER/REPO",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo",
          stars: 10,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.stars, 10);
});

test("X artifact file is parsed", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-social-"));
  const path = join(dir, "top-x-skill-tweets.json");
  writeFileSync(
    path,
    JSON.stringify([
      {
        valid_skill_repos: [
          {
            id: "owner/repo",
            github_url: "https://github.com/owner/repo",
            skill_md_path: "SKILL.md",
            name: "Root",
            description: "Root",
            stars: 3,
          },
        ],
      },
    ]),
  );

  const result = loadXSocialDiscoveryCandidates(path);
  assert.equal(result.warning, null);
  assert.equal(result.candidates[0]?.candidate.id, "owner/repo");
});
