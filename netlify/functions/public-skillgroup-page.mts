import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { recordAnalytics } from "./_shared/group-items.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>omgskills</title><style>body{font-family:ui-sans-serif,system-ui;margin:0;background:#fafafa;color:#171717}.wrap{max-width:760px;margin:0 auto;padding:48px 20px}.muted{color:#666}.item{border-top:1px solid #ddd;padding:18px 0}a{color:#075985;text-decoration:none}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function notFound(): Response {
  return html("<h1>Not found</h1>", 404);
}

function parseRoute(pathname: string): { handle: string; groupSlug: string | null } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "u" && parts[1] && parts.length <= 3) {
    return { handle: parts[1], groupSlug: parts[2] ?? null };
  }
  if (parts[0] === "profiles" && parts[1] && parts[2] === "sets" && parts[3] && parts.length === 4) {
    return { handle: parts[1], groupSlug: parts[3] };
  }
  return null;
}

function catalogSkillUrl(catalogSkillId: unknown): string | null {
  if (typeof catalogSkillId !== "string") {
    return null;
  }
  const [repoId, rawSkillPath] = catalogSkillId.split(":");
  if (!repoId || !rawSkillPath) {
    return null;
  }
  const repoParts = repoId.split("/").filter(Boolean);
  if (repoParts.length !== 2) {
    return null;
  }
  const skillParts = rawSkillPath
    .replace(/\/SKILL\.md$/i, "")
    .replace(/^SKILL\.md$/i, "")
    .split("/")
    .filter(Boolean);
  if (skillParts.length === 0) {
    return null;
  }
  const path = [...repoParts, ...skillParts].map((part) => encodeURIComponent(part)).join("/");
  return `/skills/${path}/`;
}

export default async (req: Request, context: Context) => {
  const requestPath = new URL(req.url).pathname;
  const route = parseRoute(requestPath);
  if (
    context.deploy.context !== "production" &&
    req.headers.get("x-omgskills-route-diagnostic") === "1"
  ) {
    return Response.json(
      {
        requestPath,
        contextPath: context.path || null,
        contextParams: context.params,
        resolvedHandle: route?.handle ?? null,
        resolvedGroupSlug: route?.groupSlug ?? null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!route) {
    return notFound();
  }
  const { handle, groupSlug } = route;

  const pool = getPgPool();
  const userResult = await pool.query<{
    id: string;
    handle: string;
    displayName: string | null;
    profilePublished: boolean;
  }>(
    `
      SELECT id, handle, display_name AS "displayName", profile_published AS "profilePublished"
      FROM users
      WHERE handle = $1
    `,
    [handle.toLowerCase()]
  );
  const user = userResult.rows[0];
  if (!user) {
    return notFound();
  }

  if (!user.profilePublished) {
    return html("<h1>This profile is private</h1><p class=\"muted\">The owner has not published this profile.</p>");
  }

  if (groupSlug) {
    const groupResult = await pool.query(
      `
        SELECT
          g.id,
          g.name,
          g.description,
          g.slug,
          i.id AS "itemId",
          i.kind,
          i.catalog_skill_id AS "catalogSkillId",
          i.github_url AS "itemGithubUrl",
          i.name AS "snapshotName",
          i.description AS "snapshotDescription",
          i.note,
          s.name AS "skillName",
          s.description AS "skillDescription",
          s.catalog_skill_id AS "syncedCatalogSkillId",
          s.github_url AS "githubUrl",
          s.is_local_only AS "isLocalOnly"
        FROM skill_groups g
        LEFT JOIN skill_group_items i ON i.group_id = g.id
        LEFT JOIN synced_skills s ON s.id = i.synced_skill_id
        WHERE g.owner_user_id = $1
          AND g.slug = $2
          AND g.visibility = 'public'
          AND g.disabled_at IS NULL
        ORDER BY i.position ASC
      `,
      [user.id, groupSlug.toLowerCase()]
    );
    if (groupResult.rowCount === 0) {
      return notFound();
    }
    const first = groupResult.rows[0];
    await recordAnalytics("public_group_view", { groupId: first.id, profileUserId: user.id });
    const skills = groupResult.rows
      .filter((row) => row.itemId)
      .map((row) => {
        const name = row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill";
        const description = row.skillDescription || row.snapshotDescription || row.note || (row.kind === "catalog" ? "Catalog skill" : "No description");
        const skillPageUrl = catalogSkillUrl(row.catalogSkillId || row.syncedCatalogSkillId);
        const githubUrl = row.githubUrl || row.itemGithubUrl;
        const githubLink = !row.isLocalOnly && githubUrl
          ? `/api/public/skill-open?itemId=${encodeURIComponent(row.itemId)}&url=${encodeURIComponent(githubUrl)}`
          : "";
        const link = skillPageUrl
          ? `<a href="${skillPageUrl}">Skill page</a>`
          : githubLink
            ? `<a href="${githubLink}">GitHub</a>`
            : "<span class=\"muted\">Metadata only</span>";
        return `<div class="item"><h2>${escapeHtml(name)}</h2><p class="muted">${escapeHtml(description)}</p>${link}</div>`;
      })
      .join("");
    return html(`<a href="/profiles/${escapeHtml(user.handle)}">Back to profile</a><h1>${escapeHtml(first.name)}</h1><p class="muted">${escapeHtml(first.description || "")}</p>${skills || "<p>No public skills yet.</p>"}`);
  }

  const groups = await pool.query(
    `
      SELECT g.name, g.description, g.slug, count(i.id)::int AS "itemCount"
      FROM skill_groups g
      LEFT JOIN skill_group_items i ON i.group_id = g.id
      WHERE g.owner_user_id = $1
        AND g.visibility = 'public'
        AND g.disabled_at IS NULL
      GROUP BY g.id
      ORDER BY g.is_favorites DESC, lower(g.name)
    `,
    [user.id]
  );
  const groupList = groups.rows
    .map((group) => `<div class="item"><h2><a href="/profiles/${escapeHtml(user.handle)}/sets/${escapeHtml(group.slug)}">${escapeHtml(group.name)}</a></h2><p class="muted">${escapeHtml(group.description || `${group.itemCount} skills`)}</p></div>`)
    .join("");

  await recordAnalytics("public_profile_view", { profileUserId: user.id });
  return html(`<h1>${escapeHtml(user.displayName || user.handle)}</h1><p class="muted">@${escapeHtml(user.handle)}</p>${groupList || "<p>No public Skill Groups yet.</p>"}`);
};

export const config: Config = {
  path: ["/u/:handle", "/u/:handle/:groupSlug", "/profiles/:handle/sets/:groupSlug"],
  preferStatic: true
};
