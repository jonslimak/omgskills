import type { Config } from "@netlify/functions";
import { createSkillReadmeHandler } from "./_shared/skill-readme.js";

export default createSkillReadmeHandler();

export const config: Config = {
  path: "/api/public/skill-readme",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
