import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { GitHubBrokerClient } from "./_shared/github-broker.js";
import { errorResponse, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import {
  privateSourceResponse,
  readOwnerPrivateSourceView,
  registerOwnerPrivateSource,
  type PrivateSkillSource,
  type PrivateSourceView
} from "./_shared/private-sources.js";
import { requirePortalUser, type PortalUser } from "./_shared/user.js";
import { requireJsonObject, requireString } from "./_shared/validation.js";

function requireGithubId(value: unknown, field: string): string {
  const id = requireString(value, field, 100);
  if (!/^[0-9]+$/.test(id) || id === "0") {
    throw new Response(`${field} must be a positive GitHub ID`, { status: 400 });
  }
  return id;
}

export type PortalPrivateSourcesDependencies = {
  requirePortalUser(req: Request): Promise<PortalUser>;
  readView(ownerUserId: string): Promise<PrivateSourceView>;
  register(
    ownerUserId: string,
    input: { installationId: string; repositoryId: string; root: unknown }
  ): Promise<PrivateSkillSource>;
};

function defaultDependencies(): PortalPrivateSourcesDependencies {
  const pool = getPgPool();
  return {
    requirePortalUser,
    readView(ownerUserId) {
      return readOwnerPrivateSourceView(pool, new GitHubBrokerClient(), ownerUserId);
    },
    register(ownerUserId, input) {
      return registerOwnerPrivateSource(pool, new GitHubBrokerClient(), { ownerUserId, ...input });
    }
  };
}

export async function portalPrivateSources(
  req: Request,
  _context: Context,
  dependencies?: PortalPrivateSourcesDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const resolvedDependencies = dependencies ?? defaultDependencies();
    const actor = await resolvedDependencies.requirePortalUser(req);
    if (req.method === "GET") {
      return secretJsonResponse(req, await resolvedDependencies.readView(actor.id));
    }

    const body = await requireJsonObject(req);
    const source = await resolvedDependencies.register(actor.id, {
      installationId: requireGithubId(body.installationId, "installationId"),
      repositoryId: requireGithubId(body.repositoryId, "repositoryId"),
      root: body.root
    });
    return secretJsonResponse(req, { source }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      const retryAfter = error.headers.get("retry-after");
      return secretJsonResponse(
        req,
        { error: await error.text() },
        {
          status: error.status,
          headers: retryAfter ? { "Retry-After": retryAfter } : undefined
        }
      );
    }
    const failure = privateSourceResponse(error);
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

export default async (req: Request, context: Context) => portalPrivateSources(req, context);

export const config: Config = {
  path: "/api/portal/private-sources"
};
