import type { PortalApi } from "../portal-api";
import { readOnlyApi } from "../integration/data";
import { isPortalRead } from "../portal-read-policy";
import { PortalApiError } from "../api-error";

export async function requireReviewAccess(api: PortalApi, signal?: AbortSignal | null) {
  let access: { allowed?: boolean };
  try {
    access = await api("/api/portal/review-access", {
      signal, cache: "no-store", redirect: "error",
    });
  } catch (error) {
    if (error instanceof PortalApiError && error.status === 404) {
      throw new PortalApiError("Review unavailable.", 403);
    }
    throw error;
  }
  if (access?.allowed !== true) throw new PortalApiError("Review unavailable.", 403);
}

export function reviewReadApi(api: PortalApi): PortalApi {
  const read = readOnlyApi(api);
  return async (path, init = {}) => {
    if (!isPortalRead(path, init.method) || init.body != null) {
      throw new Error("Production review is read-only.");
    }
    await requireReviewAccess(api, init.signal);
    return read(path, init);
  };
}
