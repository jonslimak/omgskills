import type { PortalApi } from "../portal-api";
import { isPortalRead } from "../portal-read-policy";
import { requireReviewAccess, reviewReadApi } from "./policy";

export const reviewTestSetName = "Portal rollout check 2026-09-25";

// The account/session-scoped receipt contains only the ID returned by this test's
// create request. Existing sets can never be adopted by name or by URL.
export function createReviewSetTest(api: PortalApi, storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, key: string) {
  const receiptKey = `${key}:disposable-set`;
  const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  let setId = storage.getItem(receiptKey);
  if (!validId(setId)) setId = null;
  let pending = false;
  const read = reviewReadApi(api);
  const ownsSet = (id: string) => setId !== null && id === setId;
  const scoped: PortalApi = async <T>(path: string, init: RequestInit = {}) => {
    if (isPortalRead(path, init.method) && init.body == null) return read<T>(path, init);
    const method = (init.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (init.body != null) {
      if (typeof init.body !== "string") throw new Error("Test set action unavailable.");
      try { body = JSON.parse(init.body); } catch { throw new Error("Test set action unavailable."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Test set action unavailable.");
    }
    const only = (...keys: string[]) => Object.keys(body).every((key) => keys.includes(key));
    const create = path === "/api/portal/groups" && method === "POST" && setId === null
      && only("name", "visibility", "syncedSkillIds") && body.name === reviewTestSetName
      && body.visibility === "private" && Array.isArray(body.syncedSkillIds) && body.syncedSkillIds.length === 0;
    const ownPath = setId !== null && path === `/api/portal/groups/${setId}`;
    const remove = ownPath && method === "DELETE" && init.body == null;
    const rename = ownPath && method === "PATCH" && only("name", "description");
    const item = setId !== null && path === `/api/portal/groups/${setId}/items`
      && (method === "POST" ? only("kind", "syncedSkillId") && body.kind === "synced"
        : method === "DELETE" && only("itemId"));
    if (pending || !(create || remove || rename || item)) throw new Error("Only the disposable review set can be edited.");
    pending = true;
    try {
      // Verify storage works before creating anything, so refresh preserves scope.
      if (create) { storage.setItem(receiptKey, "pending"); storage.removeItem(receiptKey); }
      await requireReviewAccess(api, init.signal);
      const result = await api<{ groupId?: string }>(path, { ...init, cache: "no-store", redirect: "error" });
      if (create) {
        if (!validId(result.groupId)) throw new Error("Test set created without a valid receipt. Stop and inspect.");
        setId = result.groupId;
        storage.setItem(receiptKey, setId);
      } else if (remove) {
        storage.removeItem(receiptKey);
        setId = null;
      }
      return result as T;
    } finally { pending = false; }
  };
  return { api: scoped, ownsSet };
}
