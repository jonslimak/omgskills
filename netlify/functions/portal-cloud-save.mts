import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import {
  CLOUD_SAVE_LIMITS,
  CloudSaveError,
  cloudSaveErrorStatus,
  confirmSkillReview,
  dropSkillReview,
  isCloudSaveAvailable,
  listCloudVersions,
  loadCloudVersionPackage,
  markDeletedLocally,
  parseCloudManifest,
  parseCloudSaveSettingsUpdate,
  readCloudSave,
  saveCloudVersion,
  storeCloudBlob,
  updateCloudSaveSettings
} from "./_shared/cloud-save.js";
import { CloudStoreError, createCloudObjectStore, type CloudObjectStore } from "./_shared/cloud-store.js";
import { isDeviceCredential } from "./_shared/crypto.js";
import { getPgPool } from "./_shared/db.js";
import { DeviceAuthError, requireDeviceActor, type DeviceScope } from "./_shared/device-auth.js";
import { getEnv } from "./_shared/env.js";
import { corsHeaders, optionsResponse, secretJsonResponse } from "./_shared/http.js";
import { skillPackageNdjson, SkillPackageValidationError } from "./_shared/skill-package.js";
import { requirePortalUser } from "./_shared/user.js";
import { requireJsonObject } from "./_shared/validation.js";

type Route =
  | { action: "state" }
  | { action: "settings" }
  | { action: "blob"; blobSha: string }
  | { action: "versions"; skillKey: string }
  | { action: "deleted-locally"; skillKey: string }
  | { action: "review"; skillKey: string }
  | { action: "package"; releaseId: string };

const methods: Record<Route["action"], string[]> = {
  state: ["GET"],
  settings: ["PUT"],
  blob: ["PUT"],
  versions: ["GET", "POST"],
  "deleted-locally": ["PUT"],
  review: ["POST", "DELETE"],
  package: ["GET"]
};

function parseRoute(req: Request): Route | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "portal" || parts[2] !== "cloud-save") return null;
  const rest = parts.slice(3);
  if (rest.length === 0) return { action: "state" };
  if (rest.length === 1 && rest[0] === "settings") return { action: "settings" };
  if (rest.length === 2 && rest[0] === "blobs") return { action: "blob", blobSha: rest[1] };
  if (rest.length === 3 && rest[0] === "versions" && rest[2] === "package") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rest[1])
      ? { action: "package", releaseId: rest[1] } : null;
  }
  if (rest.length === 3 && rest[0] === "skills" && ["versions", "deleted-locally", "review"].includes(rest[2])) {
    let skillKey: string;
    try {
      skillKey = decodeURIComponent(rest[1]);
    } catch {
      return null;
    }
    return { action: rest[2] as "versions" | "deleted-locally" | "review", skillKey };
  }
  return null;
}

export type CloudSaveActor = { userId: string; deviceId: string | null };

export type PortalCloudSaveDependencies = {
  available(): boolean;
  pool(): Pool;
  store(): CloudObjectStore;
  requireUser(req: Request): Promise<CloudSaveActor>;
  requireDevice(req: Request, scope: DeviceScope): Promise<CloudSaveActor>;
};

const defaultDependencies: PortalCloudSaveDependencies = {
  available: () => isCloudSaveAvailable(getEnv),
  pool: getPgPool,
  store: () => createCloudObjectStore(),
  async requireUser(req) {
    return { userId: (await requirePortalUser(req)).id, deviceId: null };
  },
  async requireDevice(req, scope) {
    const device = await requireDeviceActor(getPgPool(), req, scope);
    return { userId: device.userId, deviceId: device.deviceId };
  }
};

function presentsDeviceCredential(req: Request): boolean {
  const token = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  return Boolean(token && isDeviceCredential(token));
}

/** The signed-in user on the web, or a paired device holding the given scope. */
function actor(req: Request, dependencies: PortalCloudSaveDependencies, deviceScope: DeviceScope) {
  return presentsDeviceCredential(req) ? dependencies.requireDevice(req, deviceScope) : dependencies.requireUser(req);
}

async function requireBody(req: Request): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CLOUD_SAVE_LIMITS.maximumFileBytes) {
    throw new CloudSaveError("file_too_large", "File is too large to save");
  }
  return new Uint8Array(await req.arrayBuffer());
}

export async function portalCloudSave(
  req: Request,
  _context: Context,
  dependencies: PortalCloudSaveDependencies = defaultDependencies
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse(req);
  const route = parseRoute(req);
  if (!route) return secretJsonResponse(req, { error: "Not found" }, { status: 404 });
  if (!methods[route.action].includes(req.method)) {
    return secretJsonResponse(req, { error: "Method not allowed" }, { status: 405 });
  }

  try {
    if (!dependencies.available()) throw new CloudSaveError("unavailable", "Cloud save is not available yet");

    switch (route.action) {
      case "state": {
        const { userId } = await actor(req, dependencies, "sync:write");
        return secretJsonResponse(req, await readCloudSave(dependencies.pool(), userId));
      }
      case "settings": {
        const { userId } = await actor(req, dependencies, "content:write");
        const update = parseCloudSaveSettingsUpdate(await requireJsonObject(req));
        return secretJsonResponse(req, { settings: await updateCloudSaveSettings(dependencies.pool(), userId, update) });
      }
      case "blob": {
        const { userId, deviceId } = await dependencies.requireDevice(req, "content:write");
        const data = await requireBody(req);
        const result = await storeCloudBlob(dependencies.pool(), dependencies.store(), {
          userId,
          deviceId,
          blobSha: route.blobSha,
          data,
          // Sent by the Mac only after the user confirms a held file is safe to save.
          confirmSecrets: req.headers.get("x-cloud-save-confirm") === "secrets-reviewed"
        });
        return secretJsonResponse(req, result, { status: result.stored ? 201 : 200 });
      }
      case "versions": {
        if (req.method === "GET") {
          const { userId } = await actor(req, dependencies, "sync:write");
          const versions = await listCloudVersions(dependencies.pool(), { userId, skillKey: route.skillKey });
          return secretJsonResponse(req, { versions });
        }
        const device = await dependencies.requireDevice(req, "content:write");
        const body = await requireJsonObject(req);
        const result = await saveCloudVersion(dependencies.pool(), {
          userId: device.userId,
          deviceId: device.deviceId,
          skillKey: route.skillKey,
          files: parseCloudManifest(body),
          expectedTreeSha: body.treeSha
        });
        if (result.status === "missing_files") return secretJsonResponse(req, result, { status: 409 });
        return secretJsonResponse(req, result, { status: result.created ? 201 : 200 });
      }
      case "deleted-locally": {
        const { userId, deviceId } = await dependencies.requireDevice(req, "content:write");
        const body = await requireJsonObject(req);
        return secretJsonResponse(req, await markDeletedLocally(dependencies.pool(), {
          userId,
          deviceId,
          skillKey: route.skillKey,
          deleted: body.deleted
        }));
      }
      case "review": {
        if (req.method === "DELETE") {
          // The Mac withdraws its own waiting copy, for example after the skill was deleted there.
          const device = await dependencies.requireDevice(req, "content:write");
          await dropSkillReview(dependencies.pool(), { ...device, skillKey: route.skillKey });
          return new Response(null, { status: 204, headers: corsHeaders(req) });
        }
        const { userId, deviceId } = await actor(req, dependencies, "content:write");
        const body = await requireJsonObject(req);
        if (body.confirm !== true) throw new CloudSaveError("invalid_request", "Send confirm: true to save the held files");
        return secretJsonResponse(req, { review: await confirmSkillReview(dependencies.pool(), {
          userId,
          deviceId,
          skillKey: route.skillKey
        }) });
      }
      case "package": {
        const { userId } = await dependencies.requireDevice(req, "content:read");
        const loaded = await loadCloudVersionPackage(dependencies.pool(), dependencies.store(), {
          userId,
          releaseId: route.releaseId
        });
        const stream = skillPackageNdjson(loaded);
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
      }
    }
  } catch (error) {
    if (error instanceof CloudSaveError) {
      return secretJsonResponse(
        req,
        {
          error: error.message,
          code: error.code,
          ...(error.detail ? { detail: error.detail } : {}),
          ...(error.heldFiles ? { [error.heldFiles.some((item) => "path" in item) ? "files" : "findings"]: error.heldFiles } : {})
        },
        { status: cloudSaveErrorStatus(error) }
      );
    }
    if (error instanceof DeviceAuthError) {
      return secretJsonResponse(req, { error: error.message }, { status: error.status });
    }
    if (error instanceof CloudStoreError) {
      const status = error.code === "not_found" ? 404 : 503;
      return secretJsonResponse(req, { error: error.message }, { status });
    }
    if (error instanceof SkillPackageValidationError) {
      return secretJsonResponse(req, { error: "Saved skill is invalid" }, { status: 422 });
    }
    if (error instanceof Response) {
      return secretJsonResponse(req, { error: await error.text() }, { status: error.status });
    }
    return secretJsonResponse(req, { error: "Cloud save request failed" }, { status: 500 });
  }
}

export default (req: Request, context: Context) => portalCloudSave(req, context);

export const config: Config = {
  path: [
    "/api/portal/cloud-save",
    "/api/portal/cloud-save/settings",
    "/api/portal/cloud-save/blobs/:blobSha",
    "/api/portal/cloud-save/skills/:skillKey/versions",
    "/api/portal/cloud-save/skills/:skillKey/deleted-locally",
    "/api/portal/cloud-save/skills/:skillKey/review",
    "/api/portal/cloud-save/versions/:releaseId/package"
  ],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowLimit: 300,
    windowSize: 60
  }
};
