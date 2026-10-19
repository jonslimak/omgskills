import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import { requireAuth } from "../netlify/functions/_shared/auth.js";
import { isBrowserPairingState } from "../netlify/functions/_shared/browser-pairing.js";
import { isCodeChallenge, isCodeVerifier, isPairingCode } from "../netlify/functions/_shared/crypto.js";
import { DeviceAuthError, deviceCredentialFromRequest, listUserDevices, revokeOwnedDevice, revokePresentedDevice } from "../netlify/functions/_shared/device-auth.js";
import { exchangePairingCode, issuePairingCode } from "../netlify/functions/_shared/device-pairing.js";
import { getEnv } from "../netlify/functions/_shared/env.js";
import { findInvitedGroupIds, findOwnedGroupIds, requireGroupAccess } from "../netlify/functions/_shared/group-access.js";
import { parseInventoryCheck, performInventoryCheck, readInventoryRevision } from "../netlify/functions/_shared/inventory-reconciliation.js";
import { parseSyncReport } from "../netlify/functions/_shared/sync-skill.js";
import { readSyncInventory } from "../netlify/functions/_shared/sync-inventory-read.js";
import { performSyncUpload } from "../netlify/functions/_shared/sync-upload.js";
import { requirePortalUser, type PortalUserDependencies } from "../netlify/functions/_shared/user.js";
import { requireJsonObject, requireString } from "../netlify/functions/_shared/validation.js";
import { candidateDatabase, candidateEnvironment, candidateRoute, connectedCandidatePaths,
  requireConnectedCandidate, type CandidateRoute } from "../netlify/functions/_shared/connected-candidate.js";
import { portalSyncPairingCode } from "../netlify/functions/portal-sync-pairing-code.mjs";
import { portalSyncExchange } from "../netlify/functions/portal-sync-exchange.mjs";
import { portalSyncUpload } from "../netlify/functions/portal-sync-upload.mjs";
import { portalSyncedSkills } from "../netlify/functions/portal-synced-skills.mjs";
import { portalDeviceRevoke } from "../netlify/functions/portal-device-revoke.mjs";
import { portalDevices } from "../netlify/functions/portal-devices.mjs";
import { portalProfile } from "../netlify/functions/portal-profile.mjs";
import { portalGroups } from "../netlify/functions/portal-groups.mjs";
import { portalShared } from "../netlify/functions/portal-shared.mjs";
import { portalGroupDetail } from "../netlify/functions/portal-group-detail.mjs";

const services = { issuePairingCode, exchangePairingCode, performSyncUpload,
  readSyncInventory, revokePresentedDevice, readInventoryRevision, performInventoryCheck };
type Dependencies = {
  getEnvironment?: typeof candidateEnvironment;
  getPool?: ReturnType<typeof candidateDatabase>;
  user?: Pick<Partial<PortalUserDependencies>, "requireAuth" | "loadClerkUser">;
  services?: Partial<typeof services>;
};

async function validateBody(req: Request, route: CandidateRoute) {
  if (req.method !== "POST") return;
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new Response("JSON is required", { status: 400 });
  }
  const body = await requireJsonObject(req.clone());
  if (route === "pair") {
    if (Object.keys(body).length !== 4 || Object.keys(body).some(key => !["state", "codeChallenge", "codeChallengeMethod", "scopes"].includes(key))
      || !isBrowserPairingState(body.state) || typeof body.codeChallenge !== "string" || !isCodeChallenge(body.codeChallenge)
      || body.codeChallengeMethod !== "S256" || !Array.isArray(body.scopes) || body.scopes.length !== 2
      || !body.scopes.includes("sync:write") || !body.scopes.includes("self:revoke")) {
      throw new Response("Use the metadata-only browser approval contract", { status: 400 });
    }
  } else if (route === "exchange") {
    if (Object.keys(body).length !== 3 || Object.keys(body).some(key => !["pairingCode", "deviceName", "codeVerifier"].includes(key))
      || typeof body.pairingCode !== "string" || !isPairingCode(body.pairingCode)
      || typeof body.codeVerifier !== "string" || !isCodeVerifier(body.codeVerifier)) {
      throw new Response("Pairing code and PKCE verifier are required", { status: 400 });
    }
    requireString(body.deviceName, "deviceName", 100);
  } else if (route === "upload") {
    if (body.reportVersion !== 3) throw new Response("Only version-3 inventory is enabled", { status: 400 });
    if (Object.hasOwn(body, "mode")) parseInventoryCheck(body);
    else parseSyncReport(body);
  } else if (route === "revoke" && Object.keys(body).length !== 0) {
    throw new Response("Self-revoke does not accept a device or account ID", { status: 400 });
  }
}

function accountBearer(req: Request) {
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(req.headers.get("authorization") ?? "")) {
    throw new Response("A Clerk session bearer is required", { status: 401 });
  }
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const corsHeaders: string[] = [];
  headers.forEach((_value, key) => { if (key.startsWith("access-control-")) corsHeaders.push(key); });
  for (const key of corsHeaders) headers.delete(key);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}

// This file is outside automatic production function discovery. Only an
// explicitly prepared connected candidate may package this entry point.
export function createConnectedCandidateApi(dependencies: Dependencies = {}) {
  const getPool = dependencies.getPool ?? candidateDatabase();
  const operations = { ...services, ...dependencies.services };
  return async (req: Request, context: Context): Promise<Response> => {
    try {
      const environment = (dependencies.getEnvironment ?? candidateEnvironment)();
      const configuration = requireConnectedCandidate(req, context, environment);
      const route = candidateRoute(req);
      if (req.method === "OPTIONS") return privateResponse(new Response(null, { status: 204 }));
      await validateBody(req, route);
      const accountRead = ["read", "devices", "profile", "groups", "shared", "group-detail"].includes(route);
      if (route === "pair" || accountRead) accountBearer(req);
      else if (route !== "exchange") deviceCredentialFromRequest(req);

      let pool: Pool | undefined;
      const verifiedPool = async () => pool ??= await getPool(configuration);
      const poolReady = () => {
        if (!pool) throw new Response("Candidate database is unavailable", { status: 503 });
        return pool;
      };
      const feature = () => { requireConnectedCandidate(req, context, environment); };
      const user = (request: Request) => requirePortalUser(request, {
        requireSkillGroupsWebFeature: feature,
        getPgPool: verifiedPool,
        getEnv: name => name === "CLERK_SECRET_KEY" ? configuration.secretKey : undefined,
        ...dependencies.user,
        requireAuth: dependencies.user?.requireAuth ?? (async request => {
          if (getEnv("CLERK_SECRET_KEY") !== configuration.secretKey) {
            throw new Response("Candidate sign-in configuration is unavailable", { status: 503 });
          }
          return requireAuth(request);
        }),
      });
      let response: Response;
      if (route === "pair") {
        response = await portalSyncPairingCode(req, context, {
          getPgPool: poolReady, requirePortalUser: user, issuePairingCode: operations.issuePairingCode,
          getEnvironment: () => environment, callbackTarget: () => { feature(); return "omgskills://pair"; },
        });
      } else if (route === "read") {
        response = await portalSyncedSkills(req, context, {
          getPgPool: poolReady, requirePortalUser: user, readSyncInventory: operations.readSyncInventory,
          getEnvironment: () => environment, requireReconciliation: feature,
        });
      } else if (accountRead) {
        const reads = { getPgPool: poolReady, requirePortalUser: user };
        switch (route) {
          case "devices": response = await portalDevices(req, context, { ...reads, listUserDevices, revokeOwnedDevice }); break;
          case "profile": response = await portalProfile(req, context, reads); break;
          case "groups": response = await portalGroups(req, context, { ...reads, findOwnedGroupIds, requireGroupAccess }); break;
          case "shared": response = await portalShared(req, context, { ...reads, findInvitedGroupIds, requireGroupAccess }); break;
          case "group-detail": response = await portalGroupDetail(req, context, { ...reads, requireGroupAccess }); break;
          default: throw new Response("Not found", { status: 404 });
        }
      } else {
        await verifiedPool();
        if (route === "exchange") response = await portalSyncExchange(req, context, {
          getPgPool: poolReady, exchangePairingCode: operations.exchangePairingCode, requireSkillGroupsWebFeature: feature,
        });
        else if (route === "revoke") response = await portalDeviceRevoke(req, context, {
          getPgPool: poolReady, revokePresentedDevice: operations.revokePresentedDevice,
        });
        else response = await portalSyncUpload(req, context, {
          getPgPool: poolReady, requireSkillGroupsWebFeature: feature, performSyncUpload: operations.performSyncUpload,
          readInventoryRevision: operations.readInventoryRevision, performInventoryCheck: operations.performInventoryCheck,
          getEnvironment: () => environment, requireReconciliation: feature,
        });
      }
      return privateResponse(response);
    } catch (error) {
      return privateResponse(error instanceof Response ? error
        : error instanceof DeviceAuthError ? new Response(error.message, { status: error.status })
        : new Response("Connected candidate is unavailable", { status: 503 }));
    }
  };
}

export default createConnectedCandidateApi();
export const config: Config = {
  path: [...connectedCandidatePaths],
  method: ["GET", "POST", "OPTIONS"],
  rateLimit: { action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 30, windowSize: 60 },
};
