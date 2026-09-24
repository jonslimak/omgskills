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
    (/^\/api\/portal\/groups\/[a-zA-Z0-9_-]+\/moderation$/.test(path) && verb === "PATCH");
}

// The isolated harness deliberately excludes membership and implicit Favorites creation.
export function isIntegrationBody(path: string, method: string, body: unknown) {
  if (!isIntegrationRequest(path, method)) return false;
  if (["GET", "DELETE"].includes(method)) return body === undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  const only = (keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
  if (path === "/api/portal/profile") return only(["handle", "profilePublished"]);
  if (path === "/api/portal/groups") return only(["name", "visibility", "syncedSkillIds"])
    && typeof value.name === "string" && value.visibility === "private"
    && Array.isArray(value.syncedSkillIds) && value.syncedSkillIds.length === 0;
  if (path.endsWith("/moderation")) return only(["disabled"]) && typeof value.disabled === "boolean";
  return only(["name", "description", "visibility"]) && Object.keys(value).length > 0;
}
