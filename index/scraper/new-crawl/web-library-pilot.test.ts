import test from "node:test";
import assert from "node:assert/strict";

import { buildWebLibraryPilotSkillIds } from "./web-library-pilot.js";
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
    2,
  );

  assert.deepEqual(ids, ["openai/high:a", "openai/high:b"]);
});
