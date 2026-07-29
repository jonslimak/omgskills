import assert from "node:assert/strict";
import test from "node:test";
import { carryForwardExistingSkills } from "./carry-forward.js";
import type { Skill } from "./types.js";

function skill(id: string, name = id): Skill {
  return {
    id,
    name,
    description: "Test skill",
    github_url: `https://github.com/${id.split(":")[0]}`,
    install_cmd: "install",
    author_handle: id.split("/")[0] ?? "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-07-29T00:00:00Z",
    first_seen: "2026-07-29",
  };
}

test("carry-forward preserves existing skills not processed before a deadline", () => {
  const refreshed = skill("owner/repo:refreshed");
  const deferred = skill("owner/repo:deferred");
  const skills = [refreshed];
  const carriedForward = carryForwardExistingSkills(
    skills,
    new Map([
      [refreshed.id, skill(refreshed.id, "old refreshed")],
      [deferred.id, deferred],
    ]),
  );

  assert.equal(carriedForward, 1);
  assert.deepEqual(skills.map((value) => value.id), [refreshed.id, deferred.id]);
  assert.equal(skills[0]?.name, refreshed.name);
});
