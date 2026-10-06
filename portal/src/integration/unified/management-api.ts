import type { PortalApi } from "../../portal-api";
import { isPortalRead } from "../../portal-read-policy";

// Explicitly allow the existing account operations; server ownership checks still apply.
export function managementApi(api: PortalApi): PortalApi {
  return (path, init = {}) => {
    const method = init.method ?? "GET";
    const allowed = isPortalRead(path, method) ||
      (path === "/api/portal/groups" && method === "POST") ||
      (path === "/api/portal/profile" && method === "PATCH") ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+$/.test(path) && method === "PATCH") ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/moderation$/.test(path) && method === "PATCH") ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/items$/.test(path) && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/allowed-emails$/.test(path) && ["POST", "DELETE"].includes(method));
    if (!allowed) return Promise.reject(new Error("This action is not enabled in the local management test."));
    return api(path, { ...init, redirect: "error", cache: "no-store" });
  };
}
