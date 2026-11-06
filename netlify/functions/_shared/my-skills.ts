import { getPgPool } from "./db.js";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./http.js";
import { type CatalogSkill, loadPublishedSkills } from "./published-catalog.js";
import { requirePortalUser } from "./user.js";
import { requireJsonObject, requireString } from "./validation.js";

/** Most catalog skills one person can add to My skills. */
export const MY_SKILLS_LIMIT = 2000;
const MAX_ID_LENGTH = 500;

type QueryPool = Pick<ReturnType<typeof getPgPool>, "query">;

const defaultDependencies = {
  getPgPool: (): QueryPool => getPgPool(),
  requirePortalUser: (req: Request) => requirePortalUser(req),
  loadPublishedSkills: () => withTimeout(loadPublishedSkills(), 5_000),
};
export type MySkillsDependencies = typeof defaultDependencies;

/** The catalog id after /api/portal/my-skills/, decoded; undefined for the collection path. */
function catalogSkillIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const raw = parts.slice(3).join("/");
  if (!raw) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Response("catalogSkillId is not valid", { status: 400 });
  }
  return requireString(decoded, "catalogSkillId", MAX_ID_LENGTH);
}

type PublishedSkill = CatalogSkill & { author_handle?: unknown };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Display fields from the published catalog; all null when the skill is gone or the catalog is down. */
function displayFields(catalogSkillId: string, skill: PublishedSkill | undefined) {
  if (!skill) return { name: null, description: null, author: null, githubUrl: null };
  const owner = catalogSkillId.split("/")[0];
  return {
    name: text(skill.name),
    description: text(skill.description),
    author: text(skill.author_handle) ?? text(owner),
    githubUrl: text(skill.github_url) ?? text(skill.githubUrl),
  };
}

async function listMySkills(pool: QueryPool, userId: string, loadSkills: () => Promise<CatalogSkill[]>) {
  const [result, catalog] = await Promise.all([
    pool.query<{ catalogSkillId: string; addedAt: Date | string }>(
      `
        SELECT catalog_skill_id AS "catalogSkillId", added_at AS "addedAt"
        FROM my_skill_additions
        WHERE user_id = $1
        ORDER BY added_at DESC, catalog_skill_id
      `,
      [userId],
    ),
    loadSkills().catch(() => [] as CatalogSkill[]),
  ]);
  const wanted = new Set(result.rows.map((row) => row.catalogSkillId));
  const byId = new Map<string, PublishedSkill>();
  for (const skill of catalog) {
    if (skill.id && wanted.has(skill.id)) byId.set(skill.id, skill);
  }
  return result.rows.map((row) => ({
    catalogSkillId: row.catalogSkillId,
    addedAt: new Date(row.addedAt).toISOString(),
    ...displayFields(row.catalogSkillId, byId.get(row.catalogSkillId)),
  }));
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

export async function handleMySkills(
  req: Request,
  overrides: Partial<MySkillsDependencies> = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  const deps = { ...defaultDependencies, ...overrides };
  try {
    const pathId = catalogSkillIdFromPath(req);
    const allowed = pathId === undefined ? ["GET", "POST"] : ["DELETE"];
    if (!allowed.includes(req.method)) {
      return errorResponse(req, 405, "Method not allowed");
    }

    const user = await deps.requirePortalUser(req);

    if (req.method === "GET") {
      return jsonResponse(req, { skills: await listMySkills(deps.getPgPool(), user.id, deps.loadPublishedSkills) });
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

    const removed = await removeMySkill(deps.getPgPool(), user.id, pathId!);
    return jsonResponse(req, { removed });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to update My skills");
  }
}
