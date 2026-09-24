import type { PortalApi } from "../portal-api";
import type { PortalData } from "../app/model";
import { isAccessError } from "../api-error";
import { loadAccountData, readOnlyApi, type AccountIdentity } from "./data";

export type AccountSnapshot = {
  data: PortalData | null;
  refreshing: boolean;
  error: string;
  accessDenied: boolean;
  revision: number;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const cacheAge = 15 * 60 * 1000;

export function accountCacheKey(instance: string, userId: string, sessionId: string) {
  return `omgskills.portal.integration.v1.${instance}.${userId}.${sessionId}`;
}

function validCache(data: PortalData) {
  return data && Array.isArray(data.skills) && data.skills.every((s) =>
    s && typeof s.id === "string" && typeof s.name === "string" &&
    typeof s.source === "string" && (s.description === null || typeof s.description === "string") &&
    (s.catalogSkillId == null || typeof s.catalogSkillId === "string") &&
    (s.githubUrl === null || typeof s.githubUrl === "string")) &&
    Array.isArray(data.sets) && data.sets.every((s) => s && typeof s.id === "string" &&
      typeof s.name === "string" && typeof s.ownerName === "string" &&
      ["owner", "invited", "public"].includes(s.role) &&
      Array.isArray(s.items) && s.items.length === 0 && Array.isArray(s.emails) &&
      s.emails.every((email) => typeof email === "string") &&
      (s.membershipSkillIds === undefined || (Array.isArray(s.membershipSkillIds) &&
        s.membershipSkillIds.every((id) => typeof id === "string")))) &&
    data.profile && typeof data.profile.handle === "string" &&
    typeof data.profile.name === "string" && typeof data.profile.email === "string" &&
    typeof data.profile.published === "boolean" &&
    (data.profile.publicUrl == null || typeof data.profile.publicUrl === "string") &&
    Array.isArray(data.devices) && data.devices.length === 0 && data.privateSourceConnected === null;
}

// A session owns its cache and requests. Disposing it cannot affect a newer account.
export function createAccountSession({ api, identity, cacheKey, storage, changed, now = Date.now }: {
  api: PortalApi;
  identity: AccountIdentity;
  cacheKey: string;
  storage?: Storage;
  changed: (snapshot: AccountSnapshot) => void;
  now?: () => number;
}) {
  let active = true;
  let generation = 0;
  let lastAttempt = -Infinity;
  let request: { controller: AbortController; promise: Promise<void> } | undefined;
  let snapshot: AccountSnapshot = { data: null, refreshing: false, error: "", accessDenied: false, revision: 0 };
  const clearCache = () => { try { storage?.removeItem(cacheKey); } catch { /* Best effort. */ } };
  try {
    const cached = JSON.parse(storage?.getItem(cacheKey) || "null");
    if (cached && Number.isFinite(cached.at) && now() - cached.at >= 0 && now() - cached.at < cacheAge && validCache(cached.data)) {
      snapshot.data = { ...cached.data, profile: { ...cached.data.profile, ...identity } };
    } else clearCache();
  } catch { clearCache(); }
  function emit(change: Partial<AccountSnapshot>) {
    if (!active) return;
    snapshot = { ...snapshot, ...change };
    changed(snapshot);
  }
  function persist(data: PortalData) {
    try { storage?.setItem(cacheKey, JSON.stringify({ at: now(), data })); } catch { /* Live reads still work. */ }
  }
  function refresh(automatic = false): Promise<void> {
    if (!active) return Promise.resolve();
    if (request) return request.promise;
    if (automatic && now() - lastAttempt < 5000) return Promise.resolve();
    lastAttempt = now();
    const version = ++generation;
    const controller = new AbortController();
    emit({ refreshing: true, error: "" });
    const promise = loadAccountData(readOnlyApi(api, controller.signal), identity).then(
      (data) => {
        if (!active || version !== generation) return;
        persist(data);
        emit({ data, refreshing: false, accessDenied: false, revision: snapshot.revision + 1 });
      },
      (error) => {
        if (!active || version !== generation) return;
        const denied = isAccessError(error);
        if (denied) clearCache();
        emit({ data: denied ? null : snapshot.data, refreshing: false, accessDenied: denied,
          error: denied ? "Account access is unavailable. Sign in again or retry."
            : snapshot.data ? "Could not refresh. Showing your last loaded data."
            : "Could not load your account. Try again." });
      },
    ).finally(() => { if (request?.controller === controller) request = undefined; });
    request = { controller, promise };
    return promise;
  }
  return {
    getSnapshot: () => snapshot,
    refresh,
    dispose(removeCache = true) {
      active = false;
      generation++;
      request?.controller.abort();
      if (removeCache) clearCache();
    },
  };
}
