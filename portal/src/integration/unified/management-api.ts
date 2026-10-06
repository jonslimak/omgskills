import type { PortalApi } from "../../portal-api";
import { isPortalRead } from "../../portal-read-policy";

// The local management slice does not unlock profile, sharing or device writes.
export function managementApi(api: PortalApi): PortalApi {
  return (path, init = {}) => {
    const method = init.method ?? "GET";
    const allowed = isPortalRead(path, method) ||
      (path === "/api/portal/groups" && method === "POST") ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+$/.test(path) && method === "PATCH") ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/items$/.test(path) && ["POST", "DELETE"].includes(method));
    if (!allowed) return Promise.reject(new Error("This action is not enabled in the local management test."));
    return api(path, { ...init, redirect: "error", cache: "no-store" });
  };
}
