// This is an explicit operator attestation, not proof that a database is isolated.
// Verify the backend's Clerk instance and resolved DB before setting it to 1.
export function testBackendOrigin(env: Record<string, string | undefined>) {
  if (env.PORTAL_TEST_ENVIRONMENT_VERIFIED !== "1") return null;
  try {
    const url = new URL(env.PORTAL_TEST_API_ORIGIN || "");
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isIntegrationRead(path: string, method = "GET") {
  return (
    method.toUpperCase() === "GET" &&
    /^\/api\/portal\/(?:synced-skills|groups|shared|profile|groups\/[a-zA-Z0-9_-]+)$/.test(
      path,
    )
  );
}

export function isIntegrationRequest(path: string, method = "GET") {
  const verb = method.toUpperCase();
  return isIntegrationRead(path, method) ||
    (path === "/api/portal/profile" && verb === "PATCH") ||
    (path === "/api/portal/groups" && verb === "POST") ||
    (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+$/.test(path) && ["PATCH", "DELETE"].includes(verb)) ||
    (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/moderation$/.test(path) && verb === "PATCH") ||
    (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/items$/.test(path) && ["POST", "PATCH", "DELETE"].includes(verb)) ||
    (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/allowed-emails$/.test(path) && ["POST", "DELETE"].includes(verb));
}

// Only existing set/access operations are writable; GitHub/catalog entry and device APIs stay blocked.
export function isIntegrationBody(path: string, method: string, body: unknown) {
  if (!isIntegrationRequest(path, method)) return false;
  if (method === "GET" || (method === "DELETE" && !path.endsWith("/items") && !path.endsWith("/allowed-emails"))) return body === undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  const only = (keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
  if (path === "/api/portal/profile") return only(["handle", "profilePublished"]);
  const ids = (items: unknown) => Array.isArray(items) && items.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id)) && new Set(items).size === items.length;
  if (path.endsWith("/allowed-emails")) return method === "POST"
    ? only(["email"]) && typeof value.email === "string" && value.email.length <= 320
    : only(["emailId"]) && ids([value.emailId]);
  if (path === "/api/portal/groups") return only(["name", "visibility", "syncedSkillIds", "isFavorites"])
    && typeof value.name === "string" && ids(value.syncedSkillIds)
    && (value.isFavorites === true ? value.name === "Favorite Skills" && value.visibility === "public" && (value.syncedSkillIds as string[]).length > 0
      : value.isFavorites === undefined && value.visibility === "private");
  if (path.endsWith("/items")) {
    if (method === "POST") return only(["kind", "syncedSkillId"]) && value.kind === "synced" && ids([value.syncedSkillId]);
    if (method === "DELETE") return only(["itemId"]) && ids([value.itemId]);
    return only(["itemIds"]) && ids(value.itemIds);
  }
  if (path.endsWith("/moderation")) return only(["disabled"]) && typeof value.disabled === "boolean";
  return only(["name", "description", "visibility"]) && Object.keys(value).length > 0;
}
