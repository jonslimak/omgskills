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
  return isIntegrationRead(path, method) ||
    (path === "/api/portal/profile" && method.toUpperCase() === "PATCH");
}
