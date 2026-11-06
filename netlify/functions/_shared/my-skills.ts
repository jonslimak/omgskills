import { isDeviceCredential } from "./crypto.js";
import { getPgPool } from "./db.js";
import { DeviceAuthError, requireDeviceActor, type DeviceScope } from "./device-auth.js";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./http.js";
import { loadPublishedSkills } from "./published-catalog.js";
import { requirePortalUser } from "./user.js";
import { requireJsonObject, requireString } from "./validation.js";

/** Most catalog skills one person can add to My skills. */
export const MY_SKILLS_LIMIT = 2000;
const MAX_ID_LENGTH = 500;

type QueryPool = Pick<ReturnType<typeof getPgPool>, "query">;

const defaultDependencies = {
  getPgPool: (): QueryPool => getPgPool(),
  requirePortalUser: (req: Request) => requirePortalUser(req),
  // A paired Mac reads My skills (to count and install it) and removes from it (Delete everywhere).
  requireDevice: async (req: Request, scope: DeviceScope) => ({ id: (await requireDeviceActor(getPgPool(), req, scope)).userId }),
  // A cold instance downloads and parses the whole catalog, so adding waits as long as other catalog adds do.
  loadPublishedSkills: () => withTimeout(loadPublishedSkills(), 25_000),
};
export type MySkillsDependencies = typeof defaultDependencies;

/** The catalog id a DELETE names in ?catalogSkillId= (catalog IDs contain a slash, so not in the path). */
function catalogSkillIdFromQuery(req: Request): string {
  return requireString(new URL(req.url).searchParams.get("catalogSkillId"), "catalogSkillId", MAX_ID_LENGTH);
}

// The list is a quick database read: the web already has the library and fills in names and details from it.
async function listMySkills(pool: QueryPool, userId: string) {
  const result = await pool.query<{ catalogSkillId: string; addedAt: Date | string }>(
    `
      SELECT catalog_skill_id AS "catalogSkillId", added_at AS "addedAt"
      FROM my_skill_additions
      WHERE user_id = $1
      ORDER BY added_at DESC, catalog_skill_id
    `,
    [userId],
  );
  return result.rows.map((row) => ({ catalogSkillId: row.catalogSkillId, addedAt: new Date(row.addedAt).toISOString() }));
}

async function addMySkill(pool: QueryPool, userId: string, catalogSkillId: string): Promise<boolean> {
  // The cap is checked in the same statement as the insert.
  const inserted = await pool.query(
    `
      INSERT INTO my_skill_additions (user_id, catalog_skill_id)
      SELECT $1, $2
      WHERE (SELECT count(*) FROM my_skill_additions WHERE user_id = $1) < $3
      ON CONFLICT (user_id, catalog_skill_id) DO NOTHING
      RETURNING catalog_skill_id
    `,
    [userId, catalogSkillId, MY_SKILLS_LIMIT],
  );
  if (inserted.rows.length > 0) return true;
  const existing = await pool.query(
    `SELECT 1 FROM my_skill_additions WHERE user_id = $1 AND catalog_skill_id = $2`,
    [userId, catalogSkillId],
  );
  if (existing.rows.length > 0) return false;
  throw new Response(`My skills is full (${MY_SKILLS_LIMIT} skills)`, { status: 409 });
}

async function removeMySkill(pool: QueryPool, userId: string, catalogSkillId: string): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM my_skill_additions
      WHERE user_id = $1 AND catalog_skill_id = $2
      RETURNING catalog_skill_id
    `,
    [userId, catalogSkillId],
  );
  return result.rows.length > 0;
}

function presentsDeviceCredential(req: Request): boolean {
  const token = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  return Boolean(token && isDeviceCredential(token));
}

export async function handleMySkills(
  req: Request,
  overrides: Partial<MySkillsDependencies> = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  const deps = { ...defaultDependencies, ...overrides };
  try {
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      return errorResponse(req, 405, "Method not allowed");
    }

    // Adding is a web choice; a Mac can read and remove.
    const user = req.method !== "POST" && presentsDeviceCredential(req)
      ? await deps.requireDevice(req, req.method === "GET" ? "sync:write" : "content:write")
      : await deps.requirePortalUser(req);

    if (req.method === "GET") {
      return jsonResponse(req, { skills: await listMySkills(deps.getPgPool(), user.id) });
    }

    if (req.method === "POST") {
      const body = await requireJsonObject(req);
      const catalogSkillId = requireString(body.catalogSkillId, "catalogSkillId", MAX_ID_LENGTH);
      let skills: Awaited<ReturnType<MySkillsDependencies["loadPublishedSkills"]>>;
      try {
        skills = await deps.loadPublishedSkills();
      } catch {
        return errorResponse(req, 503, "Catalog is unavailable; try again");
      }
      if (!skills.some((skill) => skill.id === catalogSkillId)) {
        return errorResponse(req, 404, "Catalog skill not found");
      }
      const added = await addMySkill(deps.getPgPool(), user.id, catalogSkillId);
      return jsonResponse(req, { catalogSkillId, added });
    }

    const removed = await removeMySkill(deps.getPgPool(), user.id, catalogSkillIdFromQuery(req));
    return jsonResponse(req, { removed });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    if (error instanceof DeviceAuthError) return errorResponse(req, error.status, error.message);
    return errorResponse(req, 500, "Failed to update My skills");
  }
}
