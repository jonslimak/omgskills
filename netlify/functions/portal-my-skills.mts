import type { Config, Context } from "@netlify/functions";
import { handleMySkills } from "./_shared/my-skills.js";

// My skills: public catalog skills a person saved without installing (private, not Favorites).
export default async (req: Request, _context: Context) => handleMySkills(req);

export const config: Config = {
  path: ["/api/portal/my-skills", "/api/portal/my-skills/:catalogSkillId"]
};
