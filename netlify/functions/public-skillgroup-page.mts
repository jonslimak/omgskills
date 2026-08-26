import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  findGroupIdByOwnerSlug,
  findOwnedGroupIds,
  requireGroupAccess,
  type GroupAccessClient,
} from "./_shared/group-access.js";
import { recordAnalytics } from "./_shared/group-items.js";
import {
  loadCatalogSkillUrls,
  resolvePublicSkillLink,
} from "./_shared/public-skill-links.js";
import {
  parsePublicPageRoute,
  PUBLIC_SITE_ORIGIN,
  publicProfilePath,
} from "./_shared/public-group-routes.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type HtmlOptions = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  indexable?: boolean;
  publiclyCacheable?: boolean;
};

function html(body: string, status = 200, options: HtmlOptions = {}): Response {
  const title = options.title ?? "omgskills";
  const description = options.description ?? "Discover skills from trusted sources.";
  const canonical = options.canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(options.canonicalUrl)}">`
    : "";
  const robots = options.indexable === false
    ? '<meta name="robots" content="noindex,follow">'
    : "";
  const social = options.canonicalUrl
    ? `<meta property="og:type" content="website"><meta property="og:site_name" content="omgskills"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(options.canonicalUrl)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">`
    : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">${robots}${canonical}${social}<style>body{font-family:ui-sans-serif,system-ui;margin:0;background:#fafafa;color:#171717}.wrap{max-width:760px;margin:0 auto;padding:48px 20px}.muted{color:#666}.item{border-top:1px solid #ddd;padding:18px 0}a{color:#075985;text-decoration:none}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": options.publiclyCacheable
        ? "public, max-age=60, must-revalidate"
        : "no-store"
    }
  });
}

function notFound(): Response {
  return html("<h1>Not found</h1>", 404, { indexable: false });
}

export type PublicSkillgroupPageDependencies = {
  pool: GroupAccessClient;
  loadCatalogSkillUrls: typeof loadCatalogSkillUrls;
  recordAnalytics: typeof recordAnalytics;
};

function defaultDependencies(): PublicSkillgroupPageDependencies {
  return {
    pool: getPgPool(),
    loadCatalogSkillUrls,
    recordAnalytics,
  };
}

export async function publicSkillgroupPage(
  req: Request,
  context: Context,
  dependencies: PublicSkillgroupPageDependencies = defaultDependencies()
): Promise<Response> {
  const requestPath = new URL(req.url).pathname;
  const route = parsePublicPageRoute(requestPath);
  const resolvedHandleIsValid = route !== null;
  if (
    context.deploy.context !== "production" &&
    req.headers.get("x-omgskills-route-diagnostic") === "1"
  ) {
    return Response.json(
      {
        requestPath,
        contextPath: "path" in context ? String(context.path) : null,
        contextParams: context.params,
        resolvedHandle: route?.handle ?? null,
        resolvedGroupSlug: route?.kind === "group" ? route.groupSlug : null,
        resolvedHandleIsValid
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!route || !resolvedHandleIsValid) {
    return notFound();
  }
  if (requestPath !== route.canonicalPath) {
    return Response.redirect(new URL(route.canonicalPath, req.url), 301);
  }
  const { handle } = route;
  const groupSlug = route.kind === "group" ? route.groupSlug : null;

  const pool = dependencies.pool;
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
    return groupSlug
      ? notFound()
      : html(
        "<h1>This profile is private</h1><p class=\"muted\">The owner has not published this profile.</p>",
        200,
        { title: "Private profile | omgskills", indexable: false }
      );
  }

  if (groupSlug) {
    const groupId = await findGroupIdByOwnerSlug(user.id, groupSlug.toLowerCase(), pool);
    if (!groupId) {
      return notFound();
    }
    try {
      await requireGroupAccess(null, groupId, "public", pool);
    } catch (error) {
      if (error instanceof Response && error.status === 404) {
        return notFound();
      }
      throw error;
    }
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
        WHERE g.id = $1
        ORDER BY i.position ASC
      `,
      [groupId]
    );
    if (groupResult.rowCount === 0) {
      return notFound();
    }
    const first = groupResult.rows[0];
    await dependencies.recordAnalytics("public_group_view", {
      groupId: first.id,
      profileUserId: user.id,
    });
    const catalogSkillUrls = await dependencies.loadCatalogSkillUrls(req.url)
      .catch(() => new Map<string, string>());
    const skills = groupResult.rows
      .filter((row) => row.itemId)
      .map((row) => {
        const name = row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill";
        const description = row.skillDescription || row.snapshotDescription || row.note || (row.kind === "catalog" ? "Catalog skill" : "No description");
        const githubUrl = row.githubUrl || row.itemGithubUrl;
        const resolvedLink = resolvePublicSkillLink({
          catalogSkillId: row.catalogSkillId || row.syncedCatalogSkillId,
          githubUrl,
          isLocalOnly: row.isLocalOnly,
        }, catalogSkillUrls);
        const link = resolvedLink.kind === "skillPage"
          ? `<a href="${escapeHtml(resolvedLink.url)}">Skill page</a>`
          : resolvedLink.kind === "github"
            ? `<a href="/api/public/skill-open?itemId=${encodeURIComponent(row.itemId)}&url=${encodeURIComponent(resolvedLink.url)}">GitHub</a>`
            : "<span class=\"muted\">Metadata only</span>";
        return `<div class="item"><h2>${escapeHtml(name)}</h2><p class="muted">${escapeHtml(description)}</p>${link}</div>`;
      })
      .join("");
    const ownerName = user.displayName || user.handle;
    const description = first.description || `A public skill group by ${ownerName} on omgskills.`;
    const canonicalUrl = `${PUBLIC_SITE_ORIGIN}${route.canonicalPath}`;
    return html(
      `<a href="${escapeHtml(publicProfilePath(user.handle))}">Back to profile</a><h1>${escapeHtml(first.name)}</h1><p class="muted">${escapeHtml(first.description || "")}</p>${skills || "<p>No public skills yet.</p>"}`,
      200,
      {
        title: `${first.name} by ${ownerName} | omgskills`,
        description,
        canonicalUrl,
        publiclyCacheable: true,
      }
    );
  }

  const candidateIds = await findOwnedGroupIds(user.id, pool);
  const publicGroupIds = (await Promise.all(
    candidateIds.map(async (groupId) => {
      try {
        await requireGroupAccess(null, groupId, "public", pool);
        return groupId;
      } catch (error) {
        if (error instanceof Response && error.status === 404) {
          return null;
        }
        throw error;
      }
    })
  )).filter((groupId): groupId is string => Boolean(groupId));
  const groups = publicGroupIds.length === 0
    ? { rows: [] as any[] }
    : await pool.query(
    `
      SELECT g.name, g.description, g.slug, count(i.id)::int AS "itemCount"
      FROM skill_groups g
      LEFT JOIN skill_group_items i ON i.group_id = g.id
      WHERE g.id = ANY($1::uuid[])
      GROUP BY g.id
      ORDER BY g.is_favorites DESC, lower(g.name)
    `,
    [publicGroupIds]
  );
  const groupList = groups.rows
    .map((group) => `<div class="item"><h2><a href="/u/${escapeHtml(user.handle)}/sets/${escapeHtml(group.slug)}">${escapeHtml(group.name)}</a></h2><p class="muted">${escapeHtml(group.description || `${group.itemCount} skills`)}</p></div>`)
    .join("");

  await dependencies.recordAnalytics("public_profile_view", { profileUserId: user.id });
  const displayName = user.displayName || user.handle;
  return html(
    `<h1>${escapeHtml(displayName)}</h1><p class="muted">@${escapeHtml(user.handle)}</p>${groupList || "<p>No public Skill Groups yet.</p>"}`,
    200,
    {
      title: `${displayName}'s skill groups | omgskills`,
      description: `Public skill groups curated by ${displayName} on omgskills.`,
      canonicalUrl: `${PUBLIC_SITE_ORIGIN}${route.canonicalPath}`,
      publiclyCacheable: true,
    }
  );
}

export default async (req: Request, context: Context) => publicSkillgroupPage(req, context);

export const config: Config = {
  path: ["/u/:handle", "/u/:handle/sets/:groupSlug", "/u/:handle/:groupSlug", "/profiles/:handle/sets/:groupSlug"],
  preferStatic: true
};
