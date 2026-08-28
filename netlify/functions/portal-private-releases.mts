import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { GitHubBrokerClient } from "./_shared/github-broker.js";
import { corsHeaders, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import {
  PrivateReleaseAccessError,
  recordContentFetch as writeContentFetchAudit,
  requirePrivateReleaseAccess,
  samePrivateRelease,
  type PrivateReleaseGrant
} from "./_shared/private-release-access.js";
import {
  loadAuthorizedPrivateReleasePackage,
  privateReleaseResponse,
  registerOwnerPrivateRelease,
  type PrivateSkillRelease
} from "./_shared/private-releases.js";
import { skillPackageNdjson, type SkillPackage } from "./_shared/skill-package.js";
import { requirePortalUser, type PortalUser } from "./_shared/user.js";

type PrivateReleaseRoute =
  | { action: "register"; sourceId: string }
  | { action: "package"; releaseId: string };

function parseRoute(req: Request): PrivateReleaseRoute | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "portal") {
    if (parts[2] === "private-sources" && parts[4] === "releases") {
      return { action: "register", sourceId: parts[3] };
    }
    if (parts[2] === "private-releases" && parts[4] === "package") {
      return { action: "package", releaseId: parts[3] };
    }
  }
  return null;
}

function requireOpaqueId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[0-9a-f-]{16,100}$/i.test(id)) {
    throw new Response(`Invalid ${label}`, { status: 400 });
  }
  return id;
}

export type PortalPrivateReleasesDependencies = {
  requirePortalUser(req: Request): Promise<PortalUser>;
  register(ownerUserId: string, sourceId: string): Promise<PrivateSkillRelease>;
  authorize(actor: PortalUser, releaseId: string): Promise<PrivateReleaseGrant>;
  loadPackage(grant: PrivateReleaseGrant): Promise<SkillPackage>;
  recordContentFetch(grant: PrivateReleaseGrant): Promise<void>;
};

function defaultDependencies(): PortalPrivateReleasesDependencies {
  const pool = getPgPool();
  const broker = new GitHubBrokerClient();
  return {
    requirePortalUser,
    register(ownerUserId, sourceId) {
      return registerOwnerPrivateRelease(pool, broker, { ownerUserId, sourceId });
    },
    authorize(actor, releaseId) {
      return requirePrivateReleaseAccess(pool, {
        userId: actor.id,
        email: actor.email,
        deviceId: null
      }, releaseId);
    },
    loadPackage(grant) {
      return loadAuthorizedPrivateReleasePackage(broker, grant);
    },
    recordContentFetch(grant) {
      return writeContentFetchAudit(pool, grant);
    }
  };
}

export async function portalPrivateReleases(
  req: Request,
  _context: Context,
  dependencies?: PortalPrivateReleasesDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  const route = parseRoute(req);
  if (!route) return secretJsonResponse(req, { error: "Not found" }, { status: 404 });
  if (
    (route.action === "register" && req.method !== "POST")
    || (route.action === "package" && req.method !== "GET")
  ) {
    return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  }

  try {
    const resolved = dependencies ?? defaultDependencies();
    const actor = await resolved.requirePortalUser(req);
    if (route.action === "register") {
      const release = await resolved.register(
        actor.id,
        requireOpaqueId(route.sourceId, "source id")
      );
      return secretJsonResponse(req, { release }, { status: 201 });
    }

    const releaseId = requireOpaqueId(route.releaseId, "release id");
    const initialGrant = await resolved.authorize(actor, releaseId);
    const skillPackage = await resolved.loadPackage(initialGrant);
    const finalGrant = await resolved.authorize(actor, releaseId);
    if (!samePrivateRelease(initialGrant, finalGrant)) {
      throw new PrivateReleaseAccessError();
    }
    const stream = skillPackageNdjson({
      sourceId: finalGrant.sourceId,
      releaseId: finalGrant.releaseId,
      package: skillPackage
    });
    await resolved.recordContentFetch(finalGrant);
    return new Response(stream.body, {
      status: 200,
      headers: {
        ...corsHeaders(req),
        "Cache-Control": "private, no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Length": String(stream.contentLength),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return secretJsonResponse(req, { error: await error.text() }, { status: error.status });
    }
    const failure = privateReleaseResponse(error);
    const retryAfter = failure.headers.get("retry-after");
    return secretJsonResponse(
      req,
      { error: await failure.text() },
      {
        status: failure.status,
        headers: retryAfter ? { "Retry-After": retryAfter } : undefined
      }
    );
  }
}

export default async (req: Request, context: Context) => portalPrivateReleases(req, context);

export const config: Config = {
  path: [
    "/api/portal/private-sources/:sourceId/releases",
    "/api/portal/private-releases/:releaseId/package"
  ],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 10,
    windowSize: 60
  }
};
