import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  DeviceAuthError,
  requireDeviceActor as authenticateDevice
} from "./_shared/device-auth.js";
import { requireSkillGroupsFeature } from "./_shared/feature-flags.js";
import {
  readDeviceGroupManifestByRoute,
  type GroupManifestView
} from "./_shared/group-manifest-adapters.js";
import type { GroupAccessActor } from "./_shared/group-access.js";
import { optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { parseDeviceManifestRoute } from "./_shared/public-group-routes.js";

type DeviceManifestActor = {
  userId: string;
  email: string;
  deviceId: string;
};

export type DeviceGroupManifestDependencies = {
  requireFeature(): void;
  requireDeviceActor(req: Request): Promise<DeviceManifestActor>;
  readManifest(
    actor: GroupAccessActor,
    handle: string,
    groupSlug: string
  ): Promise<GroupManifestView>;
};

function defaultDependencies(): DeviceGroupManifestDependencies {
  const pool = getPgPool();
  return {
    requireFeature: requireSkillGroupsFeature,
    async requireDeviceActor(req) {
      const actor = await authenticateDevice(pool, req, "content:read");
      return {
        userId: actor.userId,
        email: actor.email,
        deviceId: actor.deviceId
      };
    },
    readManifest(actor, handle, groupSlug) {
      return readDeviceGroupManifestByRoute(pool, actor, handle, groupSlug);
    }
  };
}

function failureResponse(req: Request, status: number, message: string, source?: Response) {
  const retryAfter = source?.headers.get("Retry-After");
  return secretJsonResponse(req, { error: message }, {
    status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined
  });
}

export async function deviceGroupManifest(
  req: Request,
  _context: Context,
  dependencies: DeviceGroupManifestDependencies = defaultDependencies()
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return failureResponse(req, 405, "Method not allowed");
  }

  try {
    const route = parseDeviceManifestRoute(new URL(req.url).pathname);
    if (!route) {
      throw new Response("Group not found", { status: 404 });
    }

    dependencies.requireFeature();
    const device = await dependencies.requireDeviceActor(req);
    const view = await dependencies.readManifest(
      { id: device.userId, email: device.email },
      route.handle,
      route.groupSlug
    );
    return secretJsonResponse(req, view.manifest);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return failureResponse(req, error.status, error.message);
    }
    if (error instanceof Response) {
      return failureResponse(req, error.status, await error.text(), error);
    }
    return failureResponse(req, 500, "Manifest failed");
  }
}

export default async (req: Request, context: Context) => deviceGroupManifest(req, context);

export const config: Config = {
  path: "/api/device/groups/:handle/:groupSlug/manifest"
};
