import type { Config, Context } from "@netlify/functions";
import { handleLibraryAgents } from "./_shared/library-agents.js";

// Agents connected to My skills: list them, disconnect one, or allow it again.
export default async (req: Request, _context: Context) => handleLibraryAgents(req);

export const config: Config = {
  path: "/api/portal/library-agents"
};
