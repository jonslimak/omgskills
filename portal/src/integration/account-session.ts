import type { PortalApi } from "../portal-api";
import type { PortalData } from "../app/model";
import { isAccessError, PortalApiError } from "../api-error";
import { loadAccountData, readOnlyApi, saveProfileData, type AccountIdentity } from "./data";

export type AccountSnapshot = {
  data: PortalData | null;
  refreshing: boolean;
  error: string;
  accessDenied: boolean;
  revision: number;
  profileSaving: boolean;
  profileError: string;
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
      (s.allowedEmails === undefined || (s.role === "owner" && Array.isArray(s.allowedEmails) &&
        s.allowedEmails.every((entry) => entry && typeof entry.id === "string" && Boolean(entry.id) && typeof entry.email === "string"))) &&
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
  let mutation: { controller: AbortController; promise: Promise<void> } | undefined;
  let snapshot: AccountSnapshot = { data: null, refreshing: false, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "" };
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
    if (mutation) return mutation.promise.catch(() => {});
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
        emit({ data, refreshing: false, accessDenied: false, profileError: "", revision: snapshot.revision + 1 });
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
  function saveProfile(changes: { handle?: string; published?: boolean }): Promise<void> {
    if (!active || !snapshot.data || snapshot.accessDenied) return Promise.reject(new Error("Load your account before saving."));
    if (mutation) return Promise.reject(new Error("A profile save is already in progress."));
    const current = snapshot.data;
    const version = ++generation;
    request?.controller.abort();
    request = undefined;
    const controller = new AbortController();
    emit({ refreshing: false, profileSaving: true, profileError: "" });
    const promise = saveProfileData(api, current.profile, changes, controller.signal).then(
      (profile) => {
        if (!active || version !== generation) throw new DOMException("Account changed", "AbortError");
        const data = { ...current, profile };
        persist(data);
        emit({ data, profileSaving: false, error: "", profileError: "", revision: snapshot.revision + 1 });
      },
      (error) => {
        if (!active || version !== generation) throw new DOMException("Account changed", "AbortError");
        const denied = isAccessError(error);
        const validation = error instanceof PortalApiError && [400, 409, 422].includes(error.status);
        if (denied) clearCache();
        const message = denied ? "Account access is unavailable. Sign in again."
          : validation ? error.message : "Could not confirm the save. Refresh before trying again.";
        emit({ data: denied ? null : current, accessDenied: denied, profileSaving: false,
          profileError: message, error: denied || !validation ? message : snapshot.error });
        throw new Error(message);
      },
    ).finally(() => { if (mutation?.controller === controller) mutation = undefined; });
    mutation = { controller, promise };
    return promise;
  }
  return {
    getSnapshot: () => snapshot,
    refresh,
    saveProfile,
    dispose(removeCache = true) {
      active = false;
      generation++;
      request?.controller.abort();
      mutation?.controller.abort();
      if (removeCache) clearCache();
    },
  };
}
