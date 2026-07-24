import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTALL_ADMISSION_MAX_ALL_TIME_RANK,
  INSTALL_ADMISSION_MIN_INSTALLS,
} from "../new-crawl/admission.js";
import {
  CREATOR_WATCH_DAILY_PRIORITY_CAP,
  MOMENTUM_DAILY_PRIORITY_CAP,
} from "../new-crawl/daily-priority.js";
import {
  POLICY_ROLLOUT_CRITERIA,
  SKILLS_SH_MIN_REPO_STARS,
} from "./rollout-criteria.js";

test("rollout evidence reads structural criteria from crawler constants", () => {
  assert.equal(SKILLS_SH_MIN_REPO_STARS, 50);
  assert.deepEqual(POLICY_ROLLOUT_CRITERIA, {
    version: 1,
    skillsshMinRepoStars: 50,
    momentumDailyPriorityCap: MOMENTUM_DAILY_PRIORITY_CAP,
    creatorWatchDailyPriorityCap: CREATOR_WATCH_DAILY_PRIORITY_CAP,
    installAdmissionMaxAllTimeRank: INSTALL_ADMISSION_MAX_ALL_TIME_RANK,
    installAdmissionMinInstalls: INSTALL_ADMISSION_MIN_INSTALLS,
  });
});
