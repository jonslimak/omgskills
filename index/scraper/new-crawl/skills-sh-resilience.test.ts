import test from "node:test";
import assert from "node:assert/strict";
import { runPeriodicSkillsShSources } from "./build-shadow.js";
import {
  searchSkillsSh,
  SkillsShUnavailableError,
  type SkillsShHit,
} from "../sources/skillssh.js";

function hit(board: "all-time" | "trending" | "hot"): SkillsShHit {
  return {
    id: `owner/repo:${board}`,
    path: "skills/example/SKILL.md",
    skill_name_hint: board,
    github_url: "https://github.com/owner/repo",
    author_handle: "owner",
    installs: 100,
    trending_rank: 1,
    trending_source: "skills.sh",
    board,
  };
}

test("periodic skills.sh continues after one board is temporarily unavailable", async () => {
  const boards: string[] = [];
  const search: typeof searchSkillsSh = async (options = {}) => {
    const board = options.board ?? "all-time";
    boards.push(board);
    if (board === "all-time") {
      throw new SkillsShUnavailableError("temporary timeout");
    }
    return [hit(board)];
  };

  const runs = await runPeriodicSkillsShSources(search);

  assert.deepEqual(boards, ["all-time", "trending", "hot"]);
  assert.deepEqual(runs.map((run) => run.summary.source), [
    "skillssh:all-time",
    "skillssh:trending",
    "skillssh:hot",
  ]);
  assert.equal(runs[0]?.summary.hitCount, 0);
  assert.equal(runs[0]?.warning, "skillssh:all-time unavailable; existing library data preserved");
  assert.deepEqual(runs.slice(1).map((run) => run.summary.hitCount), [1, 1]);
  assert.deepEqual(runs.slice(1).map((run) => run.warning), [null, null]);
});

test("periodic skills.sh keeps unexpected failures blocking", async () => {
  const search: typeof searchSkillsSh = async () => {
    throw new Error("malformed successful response");
  };

  await assert.rejects(
    runPeriodicSkillsShSources(search),
    /malformed successful response/,
  );
});
