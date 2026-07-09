import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { addGroupItem, requireOwnedGroup } from "./_shared/group-items.js";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, requireString } from "./_shared/validation.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

async function getSyncedSkill(userId: string, syncedSkillId: string) {
  const result = await getPgPool().query<{ id: string }>(
    `
      SELECT id
      FROM synced_skills
      WHERE id = $1
        AND user_id = $2
        AND is_current = true
      LIMIT 1
    `,
    [syncedSkillId, userId]
  );
  return result.rows[0] ?? null;
}

async function canViewGroup(userId: string, email: string, groupId: string) {
  const result = await getPgPool().query<{ id: string }>(
    `
      SELECT g.id
      FROM skill_groups g
      LEFT JOIN skill_group_allowed_emails a ON a.group_id = g.id
      WHERE g.id = $1
        AND g.disabled_at IS NULL
        AND (
          g.owner_user_id = $2
          OR g.visibility = 'public'
          OR (g.visibility = 'restricted' AND a.email = $3)
        )
      LIMIT 1
    `,
    [groupId, userId, email]
  );
  return Boolean(result.rows[0]);
}

async function listGroupItems(req: Request, groupId: string) {
  const user = await requirePortalUser(req);
  const canView = await canViewGroup(user.id, user.email, groupId);
  if (!canView) {
    throw new Response("Group not found", { status: 404 });
  }

  const result = await getPgPool().query(
    `
      SELECT
        i.id,
        i.kind,
        i.catalog_skill_id AS "catalogSkillId",
        i.github_url AS "itemGithubUrl",
        i.name AS "snapshotName",
        i.description AS "snapshotDescription",
        i.note,
        i.position,
        s.name AS "skillName",
        s.description AS "skillDescription",
        s.github_url AS "githubUrl",
        s.source
      FROM skill_group_items i
      LEFT JOIN synced_skills s ON s.id = i.synced_skill_id
      WHERE i.group_id = $1
      ORDER BY i.position ASC
    `,
    [groupId]
  );

  const items = result.rows.map((row: any) => ({
    id: row.id,
    kind: row.kind,
    name: row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill",
    description: row.skillDescription || row.snapshotDescription || row.note || "",
    githubUrl: row.githubUrl || row.itemGithubUrl || null,
    source: row.source || row.kind,
    position: row.position
  }));

  return jsonResponse(req, { items });
}

function parseGithubSkillUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Response("GitHub URL is invalid", { status: 400 });
  }

  if (url.hostname !== "github.com") {
    throw new Response("Only github.com URLs are supported", { status: 400 });
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Response("GitHub URL must include owner and repo", { status: 400 });
  }
  return url;
}

function rawSkillMdCandidates(url: URL): string[] {
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  const blobIndex = parts.indexOf("blob");
  if (blobIndex >= 0 && parts[blobIndex + 1]) {
    const branch = parts[blobIndex + 1];
    const path = parts.slice(blobIndex + 2).join("/");
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`];
  }
  return [
    `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`
  ];
}

function hasFrontmatterField(markdown: string, field: string): boolean {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  return Boolean(frontmatter?.[1].match(new RegExp(`^${field}:\\s*.+$`, "m")));
}

function frontmatterField(markdown: string, field: string): string | null {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const match = frontmatter?.[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

async function validateGithubSkill(rawUrl: string) {
  const url = parseGithubSkillUrl(rawUrl);
  for (const candidate of rawSkillMdCandidates(url)) {
    const response = await withTimeout(fetch(candidate), 8000);
    if (!response.ok) {
      continue;
    }
    const markdown = await response.text();
    if (!hasFrontmatterField(markdown, "name") || !hasFrontmatterField(markdown, "description")) {
      throw new Response("SKILL.md must include name and description frontmatter", { status: 400 });
    }
    return {
      rawSkillUrl: candidate,
      name: frontmatterField(markdown, "name"),
      description: frontmatterField(markdown, "description")
    };
  }
  throw new Response("Could not find a valid public SKILL.md", { status: 400 });
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (!["GET", "POST"].includes(req.method)) {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }
    if (req.method === "GET") {
      return await listGroupItems(req, groupId);
    }

    const user = await requirePortalUser(req);
    await requireOwnedGroup(user.id, groupId);

    const body = await req.json();
    const kind = body?.kind;
    if (kind === "synced") {
      const syncedSkillId = requireString(body?.syncedSkillId, "syncedSkillId", 80);
      const available = await getSyncedSkill(user.id, syncedSkillId);
      if (!available) {
        throw new Response("Synced skill is unavailable", { status: 400 });
      }
      const note = optionalString(body?.note, 1000);
      const item = await addGroupItem(groupId, { kind: "synced", syncedSkillId, note });
      return jsonResponse(req, item, { status: 201 });
    }
    if (kind === "catalog") {
      const catalogSkillId = requireString(body?.catalogSkillId, "catalogSkillId", 500);
      const name = optionalString(body?.name, 200);
      const description = optionalString(body?.description, 2000);
      const note = optionalString(body?.note, 1000);
      const item = await addGroupItem(groupId, { kind: "catalog", catalogSkillId, name, description, note });
      return jsonResponse(req, item, { status: 201 });
    }
    if (kind === "github") {
      const githubUrl = requireString(body?.githubUrl, "githubUrl", 500);
      const validated = await validateGithubSkill(githubUrl);
      const note = optionalString(body?.note, 1000);
      const item = await addGroupItem(groupId, {
        kind: "github",
        githubUrl,
        name: validated.name,
        description: validated.description,
        note
      });
      return jsonResponse(req, item, { status: 201 });
    }

    throw new Response("kind must be synced, catalog, or github", { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to add group item");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/items"
};
