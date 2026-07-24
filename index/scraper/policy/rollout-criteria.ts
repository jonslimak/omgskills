import {
  INSTALL_ADMISSION_MAX_ALL_TIME_RANK,
  INSTALL_ADMISSION_MIN_INSTALLS,
} from "../new-crawl/admission.js";
import {
  CREATOR_WATCH_DAILY_PRIORITY_CAP,
  MOMENTUM_DAILY_PRIORITY_CAP,
} from "../new-crawl/daily-priority.js";

export const SKILLS_SH_MIN_REPO_STARS = 50;

export const POLICY_ROLLOUT_CRITERIA = {
  version: 1,
  skillsshMinRepoStars: SKILLS_SH_MIN_REPO_STARS,
  momentumDailyPriorityCap: MOMENTUM_DAILY_PRIORITY_CAP,
  creatorWatchDailyPriorityCap: CREATOR_WATCH_DAILY_PRIORITY_CAP,
  installAdmissionMaxAllTimeRank: INSTALL_ADMISSION_MAX_ALL_TIME_RANK,
  installAdmissionMinInstalls: INSTALL_ADMISSION_MIN_INSTALLS,
} as const;
