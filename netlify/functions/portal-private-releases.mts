import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  DeviceAuthError,
  requireDeviceActor as authenticateDevice
} from "./_shared/device-auth.js";
import { GitHubBrokerClient } from "./_shared/github-broker.js";
import { CloudSaveError, loadSharedCloudPackage } from "./_shared/cloud-save.js";
import { CloudStoreError, createCloudObjectStore } from "./_shared/cloud-store.js";
import { requireSkillGroupsFeature } from "./_shared/feature-flags.js";
import { corsHeaders, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import {
  PrivateReleaseAccessError,
  recordContentFetch as writeContentFetchAudit,
  requirePrivateReleaseAccess,
  samePrivateRelease,
  type PrivateReleaseActor,
  type PrivateReleaseGrant
} from "./_shared/private-release-access.js";
import {
  loadAuthorizedPrivateReleasePackage,
  privateReleaseResponse,
  registerOwnerPrivateRelease,
  type PrivateSkillRelease
} from "./_shared/private-releases.js";
import { skillPackageNdjson, type SkillPackage } from "./_shared/skill-package.js";
import { skillMdBody } from "./_shared/skill-readme.js";
import { requirePortalUser, type PortalUser } from "./_shared/user.js";

type PrivateReleaseRoute =
  | { action: "register"; sourceId: string }
  | { action: "package"; releaseId: string }
  | { action: "skill-md"; releaseId: string };

function parseRoute(req: Request): PrivateReleaseRoute | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "portal") {
    if (parts[2] === "private-sources" && parts[4] === "releases") {
      return { action: "register", sourceId: parts[3] };
    }
    if (parts[2] === "private-releases" && parts[4] === "package") {
      return { action: "package", releaseId: parts[3] };
    }
    if (parts[2] === "private-releases" && parts[4] === "skill-md") {
      return { action: "skill-md", releaseId: parts[3] };
    }
  }
  return null;
}

const SKILL_MD_CHARACTER_LIMIT = 20_000;

/** A shared skill's SKILL.md for reading on the web, without its frontmatter; shortened like a library README. */
export function sharedSkillMd(skillPackage: SkillPackage): { markdown: string; truncated: boolean } | null {
  const entry = skillPackage.entries.find(file => file.path === "SKILL.md")
    ?? skillPackage.entries.find(file => file.path.toLowerCase() === "skill.md");
  if (!entry) return null;
  const text = skillMdBody(new TextDecoder().decode(entry.data));
  return {
    markdown: text.slice(0, SKILL_MD_CHARACTER_LIMIT).replace(/[\uD800-\uDBFF]$/, ""),
    truncated: text.length > SKILL_MD_CHARACTER_LIMIT
  };
}

function requireOpaqueId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[0-9a-f-]{16,100}$/i.test(id)) {
    throw new Response(`Invalid ${label}`, { status: 400 });
  }
  return id;
}

export type PortalPrivateReleasesDependencies = {
  requireMacFeature(): void;
  requirePortalUser(req: Request): Promise<PortalUser>;
  requireDeviceActor(req: Request): Promise<PrivateReleaseActor>;
  register(ownerUserId: string, sourceId: string): Promise<PrivateSkillRelease>;
  authorize(actor: PrivateReleaseActor, releaseId: string): Promise<PrivateReleaseGrant>;
  loadPackage(grant: PrivateReleaseGrant): Promise<SkillPackage>;
  recordContentFetch(grant: PrivateReleaseGrant): Promise<void>;
};

function defaultDependencies(): PortalPrivateReleasesDependencies {
  const pool = getPgPool();
  const broker = new GitHubBrokerClient();
  return {
    requireMacFeature: requireSkillGroupsFeature,
    requirePortalUser,
    async requireDeviceActor(req) {
      try {
        const actor = await authenticateDevice(pool, req, "content:read");
        return {
          userId: actor.userId,
          email: actor.email,
          deviceId: actor.deviceId
        };
      } catch (error) {
        if (error instanceof DeviceAuthError) throw new PrivateReleaseAccessError();
        throw error;
      }
    },
    register(ownerUserId, sourceId) {
      return registerOwnerPrivateRelease(pool, broker, { ownerUserId, sourceId });
    },
    authorize(actor, releaseId) {
      return requirePrivateReleaseAccess(pool, actor, releaseId);
    },
    loadPackage(grant) {
      // A version saved to the cloud comes from the owner's storage, not GitHub.
      return grant.sourceKind === "cloud"
        ? loadSharedCloudPackage(pool, createCloudObjectStore(), grant)
        : loadAuthorizedPrivateReleasePackage(broker, grant);
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
    || (route.action !== "register" && req.method !== "GET")
  ) {
    return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  }

  try {
    if (route.action !== "register") {
      // Shared content, on the web or a Mac, stops with the same switch.
      (dependencies?.requireMacFeature ?? requireSkillGroupsFeature)();
    }
    const resolved = dependencies ?? defaultDependencies();
    if (route.action === "register") {
      const actor = await resolved.requirePortalUser(req);
      const release = await resolved.register(
        actor.id,
        requireOpaqueId(route.sourceId, "source id")
      );
      return secretJsonResponse(req, { release }, { status: 201 });
    }

    const releaseId = requireOpaqueId(route.releaseId, "release id");
    if (route.action === "skill-md") {
      // Invitees read a shared skill's instructions on the web under the same invite check as the Mac download.
      const user = await resolved.requirePortalUser(req);
      const actor = { userId: user.id, email: user.email, deviceId: null };
      const grant = await resolved.authorize(actor, releaseId);
      const document = sharedSkillMd(await resolved.loadPackage(grant));
      const finalGrant = await resolved.authorize(actor, releaseId);
      if (!document || !samePrivateRelease(grant, finalGrant)) throw new PrivateReleaseAccessError();
      await resolved.recordContentFetch(finalGrant);
      return secretJsonResponse(req, document);
    }
    const initialActor = await resolved.requireDeviceActor(req);
    const initialGrant = await resolved.authorize(initialActor, releaseId);
    const skillPackage = await resolved.loadPackage(initialGrant);
    const finalActor = await resolved.requireDeviceActor(req);
    const finalGrant = await resolved.authorize(finalActor, releaseId);
    if (
      initialActor.userId !== finalActor.userId
      || initialActor.deviceId !== finalActor.deviceId
      || !samePrivateRelease(initialGrant, finalGrant)
    ) {
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
    if (error instanceof CloudStoreError && error.code !== "not_found") {
      return secretJsonResponse(req, { error: "Cloud storage is unavailable" }, { status: 503 });
    }
    // A shared cloud version that's gone looks the same as one never shared.
    const failure = privateReleaseResponse(
      error instanceof CloudSaveError || error instanceof CloudStoreError ? new PrivateReleaseAccessError() : error
    );
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
