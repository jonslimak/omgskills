import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildWebLibraryPilotSkillIds,
  buildWebLibraryPilotSnippetCoverage,
  loadWebLibraryPilotAssets,
} from "./web-library-pilot.js";
import type { ShadowSkillRecord } from "./types.js";

function skill(id: string, author: string, stars: number, name = id): ShadowSkillRecord {
  return {
    id,
    name,
    description: name,
    github_url: `https://github.com/${id.split(":")[0]}`,
    install_cmd: "install",
    author_handle: author,
    tags: [],
    stars,
    last_updated: "2026-07-09T00:00:00Z",
    first_seen: "2026-07-09",
    publisher_handle: author,
    publisher_repo: id.split(":")[0] ?? "",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
  };
}

function skillWithSnippet(id: string, snippet?: string): ShadowSkillRecord {
  return {
    ...skill(id, "owner", 1),
    readme_snippet: snippet,
  };
}

test("web library pilot ids include featured and collection skill ids", () => {
  const ids = buildWebLibraryPilotSkillIds(
    [
      {
        type: "topic",
        featuredSkillIds: ["owner/repo:featured", "owner/repo:shared"],
        skillIds: ["owner/repo:skill", "owner/repo:shared"],
      },
    ],
    [],
  );

  assert.deepEqual(ids, ["owner/repo:featured", "owner/repo:shared", "owner/repo:skill"]);
});

test("web library pilot ids include top author skills like web generator", () => {
  const ids = buildWebLibraryPilotSkillIds(
    [
      {
        type: "author",
        authorHandle: "OpenAI",
      },
    ],
    [
      skill("openai/low:z", "openai", 1, "zeta"),
      skill("openai/high:b", "openai", 100, "beta"),
      skill("openai/high:a", "openai", 100, "alpha"),
      skill("other/high", "other", 1000, "other"),
    ],
    { maxAuthorSkills: 2 },
  );

  assert.deepEqual(ids, ["openai/high:a", "openai/high:b"]);
});

test("web library pilot ids include a bounded deduplicated trending head", () => {
  const ids = buildWebLibraryPilotSkillIds(
    [
      {
        type: "topic",
        skillIds: ["owner/repo:shared"],
      },
    ],
    [],
    {
      trendingSkillIds: [
        "owner/repo:shared",
        "owner/repo:trend-one",
        "owner/repo:trend-two",
      ],
      maxTrendingSkills: 2,
    },
  );

  assert.deepEqual(ids, ["owner/repo:shared", "owner/repo:trend-one"]);
});

test("web library pilot assets fall back together to the next manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "omgskills-web-pilot-"));
  try {
    const crawl4Dir = join(root, "crawl4");
    const v2Dir = join(root, "v2");
    mkdirSync(crawl4Dir, { recursive: true });
    mkdirSync(v2Dir, { recursive: true });
    writeFileSync(
      join(crawl4Dir, "manifest.json"),
      JSON.stringify({
        skills: { path: "missing-skills.json" },
        collections: { path: "collections.json" },
      }),
    );
    writeFileSync(
      join(crawl4Dir, "collections.json"),
      JSON.stringify({
        collections: [{
          id: "author-wrong-track",
          type: "author",
          authorHandle: "wrong-track",
        }],
      }),
    );
    writeFileSync(
      join(v2Dir, "manifest.json"),
      JSON.stringify({
        skills: { path: "skills.json", bytes: 3 },
        collections: { path: "collections.json" },
      }),
    );
    writeFileSync(join(v2Dir, "skills.json"), "[]\n");
    writeFileSync(
      join(v2Dir, "collections.json"),
      JSON.stringify({
        collections: [{
          id: "author-openai",
          type: "author",
          authorHandle: "openai",
          featuredSkillIds: ["openai/codex:code-review"],
        }],
      }),
    );
    const trendingPath = join(root, "trending.json");
    writeFileSync(
      trendingPath,
      JSON.stringify([
        { id: "owner/repo:one" },
        { id: "owner/repo:two" },
        { id: "owner/repo:three" },
      ]),
    );

    assert.deepEqual(
      loadWebLibraryPilotAssets(
        [join(crawl4Dir, "manifest.json"), join(v2Dir, "manifest.json")],
        trendingPath,
        2,
      ),
      {
        collections: [{
          id: "author-openai",
          type: "author",
          authorHandle: "openai",
          featuredSkillIds: ["openai/codex:code-review"],
        }],
        trendingSkillIds: ["owner/repo:one", "owner/repo:two"],
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("web library pilot assets require at least one manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "omgskills-web-pilot-"));
  const trendingPath = join(root, "trending.json");
  writeFileSync(trendingPath, "[]\n");
  assert.throws(
    () => loadWebLibraryPilotAssets(
      ["/missing/crawl4.json", "/missing/v2.json"],
      trendingPath,
    ),
    /Missing web-library manifest/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("web library pilot coverage classifies every scheduled skill", () => {
  const coverage = buildWebLibraryPilotSnippetCoverage({
    skillIds: [
      "owner/repo:present",
      "owner/repo:failed",
      "owner/repo:no-readme",
      "owner/repo:earlier",
      "owner/repo:missing",
    ],
    skills: [
      skillWithSnippet("owner/repo:present", "Useful README context"),
      skillWithSnippet("owner/repo:failed"),
      skillWithSnippet("owner/repo:no-readme"),
      skillWithSnippet("owner/repo:earlier"),
    ],
    refreshMode: "scheduled",
    fetchFailures: new Map([["owner/repo:failed", "validationFailed"]]),
    refreshedEarlierSkillIds: new Set(["owner/repo:earlier"]),
    successfulSnippetRefreshSkillIds: new Set(["owner/repo:no-readme"]),
  });

  assert.deepEqual(
    {
      selectedSkillCount: coverage.selectedSkillCount,
      snippetPresentCount: coverage.snippetPresentCount,
      fetchFailureCount: coverage.fetchFailureCount,
      intentionalExemptionCount: coverage.intentionalExemptionCount,
    },
    {
      selectedSkillCount: 5,
      snippetPresentCount: 1,
      fetchFailureCount: 1,
      intentionalExemptionCount: 3,
    },
  );
  assert.deepEqual(coverage.entries, [
    { skillId: "owner/repo:present", status: "snippetPresent" },
    { skillId: "owner/repo:failed", status: "fetchFailure", reason: "validationFailed" },
    { skillId: "owner/repo:no-readme", status: "intentionalExemption", reason: "noUsableReadme" },
    { skillId: "owner/repo:earlier", status: "intentionalExemption", reason: "alreadyRefreshedThisRun" },
    { skillId: "owner/repo:missing", status: "intentionalExemption", reason: "missingFromCatalog" },
  ]);
});

test("web library pilot coverage records cadence and work-skip exemptions", () => {
  const skills = [skillWithSnippet("owner/repo:missing-snippet")];

  assert.deepEqual(
    buildWebLibraryPilotSnippetCoverage({
      skillIds: ["owner/repo:missing-snippet"],
      skills,
      refreshMode: "notScheduled",
    }).entries,
    [{
      skillId: "owner/repo:missing-snippet",
      status: "intentionalExemption",
      reason: "refreshNotScheduled",
    }],
  );
  assert.deepEqual(
    buildWebLibraryPilotSnippetCoverage({
      skillIds: ["owner/repo:missing-snippet"],
      skills,
      refreshMode: "skipped",
    }).entries,
    [{
      skillId: "owner/repo:missing-snippet",
      status: "intentionalExemption",
      reason: "refreshWorkSkipped",
    }],
  );
});

test("scheduled web library pilot coverage rejects an unclassified skill", () => {
  assert.throws(
    () => buildWebLibraryPilotSnippetCoverage({
      skillIds: ["owner/repo:unclassified"],
      skills: [skillWithSnippet("owner/repo:unclassified")],
      refreshMode: "scheduled",
    }),
    /has no refresh outcome/,
  );
});
