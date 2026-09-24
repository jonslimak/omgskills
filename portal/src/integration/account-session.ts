import type { PortalApi } from "../portal-api";
import type { PortalData } from "../app/model";
import { isAccessError, PortalApiError } from "../api-error";
import { loadAccountData, readOnlyApi, saveProfileData, type AccountIdentity } from "./data";
import { saveSetData, type SetCommand } from "./set-data";
import { changeMembership, changeFavorites, createSelectedSet, removeMembershipItem, reorderMembership, emptyMembershipResult, type MembershipCommand } from "./membership-data";
import { groupSyncedSkills } from "../synced-skill-grouping";
import type { MembershipResult } from "../app/model";

export type AccountSnapshot = {
  data: PortalData | null;
  refreshing: boolean;
  error: string;
  accessDenied: boolean;
  revision: number;
  profileSaving: boolean;
  profileError: string;
  setSaving: boolean;
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
      (s.slug === undefined || typeof s.slug === "string") &&
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
  let mutation: { controller: AbortController; promise: Promise<unknown> } | undefined;
  let snapshot: AccountSnapshot = { data: null, refreshing: false, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "", setSaving: false };
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
    if (mutation) return mutation.promise.then(() => {}, () => {});
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
    if (mutation) return Promise.reject(new Error("A save is already in progress."));
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
  function saveSet(command: SetCommand): Promise<{ groupId: string; refreshed: boolean }> {
    if (!active || !snapshot.data || snapshot.accessDenied || snapshot.error) return Promise.reject(new Error("Refresh your account before saving."));
    if (mutation) return Promise.reject(new Error("A save is already in progress."));
    const current = snapshot.data;
    const version = ++generation;
    request?.controller.abort();
    request = undefined;
    const controller = new AbortController();
    const checkActive = () => {
      if (!active || version !== generation) throw new DOMException("Account changed", "AbortError");
    };
    emit({ refreshing: false, setSaving: true });
    const promise = (async () => {
      let result: Awaited<ReturnType<typeof saveSetData>>;
      try { result = await saveSetData(api, command, controller.signal); }
      catch (error) {
        checkActive();
        const denied = isAccessError(error);
        const rejected = error instanceof PortalApiError && [400, 404, 409, 422, 429].includes(error.status);
        if (denied) clearCache();
        const message = denied ? "Account access is unavailable. Sign in again."
          : rejected ? error.message : "Could not confirm the save. Refresh before trying again.";
        emit({ data: denied ? null : current, accessDenied: denied, setSaving: false,
          error: denied || !rejected ? message : "" });
        throw new Error(message);
      }
      checkActive();
      // Preserve confirmed changes even if the following summary read fails.
      const sets = command.kind === "delete" ? current.sets.filter((set) => set.id !== result.groupId)
        : current.sets.map((set) => set.id === result.groupId ? { ...set, ...result.fields,
          ...(command.kind === "moderate" ? { hidden: command.hidden } : {}) } : set);
      const confirmed = { ...current, sets };
      persist(confirmed);
      emit({ data: confirmed });
      try {
        const data = await loadAccountData(readOnlyApi(api, controller.signal), identity);
        checkActive();
        persist(data);
        emit({ data, error: "", setSaving: false, revision: snapshot.revision + 1 });
        return { groupId: result.groupId, refreshed: true };
      } catch (error) {
        checkActive();
        const denied = isAccessError(error);
        if (denied) clearCache();
        emit({ data: denied ? null : confirmed, accessDenied: denied, setSaving: false, revision: snapshot.revision + 1,
          error: denied ? "Saved, but account access is unavailable. Sign in again."
            : "Saved, but could not refresh your account. Refresh to continue." });
        return { groupId: result.groupId, refreshed: false };
      }
    })().finally(() => { if (mutation?.controller === controller) mutation = undefined; });
    mutation = { controller, promise };
    return promise;
  }
  function saveMembership(command: MembershipCommand): Promise<MembershipResult> {
    if (!active || !snapshot.data || snapshot.accessDenied || snapshot.error) return Promise.reject(new Error("Refresh your account before saving."));
    if (mutation) return Promise.reject(new Error("A save is already in progress."));
    const current = snapshot.data;
    const version = ++generation;
    request?.controller.abort(); request = undefined;
    const controller = new AbortController();
    const signal = controller.signal;
    const scoped: PortalApi = (path, init) => api(path, { ...init, signal, redirect: "error", cache: "no-store" });
    const checkActive = () => { if (!active || version !== generation) throw new DOMException("Account changed", "AbortError"); };
    emit({ refreshing: false, setSaving: true });
    const promise = (async () => {
      let result = emptyMembershipResult();
      let failure: unknown;
      try {
        if (command.kind === "remove-item") await removeMembershipItem(scoped, command.id, command.itemId, signal);
        else if (command.kind === "reorder") await reorderMembership(scoped, command.id, command.itemIds, signal);
        else {
          const live = new Map(groupSyncedSkills(current.skills).map((skill) => [skill.id, skill]));
          const skills = [...new Set(command.skills.map((skill) => skill.id))].map((id) => {
            const skill = live.get(id);
            if (!skill) throw new PortalApiError("Your selected skills changed. Refresh and select them again.", 409);
            return skill;
          });
          result = command.kind === "change" ? await changeMembership(scoped, command.id, skills, command.add, signal)
            : command.kind === "favorites" ? await changeFavorites(scoped, current.sets, skills, command.add, signal)
            : await createSelectedSet(scoped, command.name, skills, signal);
        }
      } catch (error) { failure = error; }
      checkActive();
      const denied = isAccessError(failure);
      const unknown = failure && (!(failure instanceof PortalApiError) || failure.status >= 500);
      if (denied) {
        clearCache();
        emit({ data: null, accessDenied: true, setSaving: false, error: "Account access is unavailable. Sign in again." });
        throw new Error("Account access is unavailable. Sign in again.");
      }
      // Reconcile even a partial batch; never replay writes to recover a failed read.
      let data = current;
      let refreshError = "";
      try { data = await loadAccountData(readOnlyApi(scoped), identity); checkActive(); persist(data); }
      catch (error) {
        checkActive();
        if (isAccessError(error)) {
          clearCache();
          emit({ data: null, accessDenied: true, setSaving: false, error: "Changes may have saved, but account access is unavailable. Sign in again." });
          throw new Error("Account access is unavailable. Sign in again.");
        }
        refreshError = "Could not refresh after the operation. Refresh to confirm the latest membership.";
      }
      emit({ data, setSaving: false, revision: snapshot.revision + 1,
        error: unknown || result.uncertain ? "Some changes could not be confirmed. Refresh before continuing." : refreshError });
      if (failure) throw new Error(unknown ? "Could not confirm all changes. Refresh before trying again."
        : failure instanceof Error ? failure.message : "Could not update the set.");
      return result;
    })().finally(() => { if (mutation?.controller === controller) mutation = undefined; });
    mutation = { controller, promise };
    return promise;
  }
  return {
    getSnapshot: () => snapshot,
    refresh,
    saveProfile,
    saveSet,
    saveMembership,
    invalidateAccess() {
      generation++;
      request?.controller.abort(); request = undefined;
      mutation?.controller.abort(); mutation = undefined;
      clearCache();
      emit({ data: null, accessDenied: true, refreshing: false, profileSaving: false, setSaving: false,
        error: "Account access is unavailable. Sign in again or retry." });
    },
    dispose(removeCache = true) {
      active = false;
      generation++;
      request?.controller.abort();
      mutation?.controller.abort();
      if (removeCache) clearCache();
    },
  };
}
