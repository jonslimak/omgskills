#!/usr/bin/env node

import { createSign } from "node:crypto";
import { fileURLToPath } from "node:url";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUIRED_ENV = [
  "OMGSKILLS_GITHUB_BROKER_APP_ID",
  "OMGSKILLS_GITHUB_BROKER_INSTALLATION_ID",
  "OMGSKILLS_GITHUB_BROKER_PRIVATE_KEY",
  "OMGSKILLS_GITHUB_BROKER_ALLOWED_REPOSITORY",
  "OMGSKILLS_GITHUB_BROKER_DENIED_REPOSITORY",
  "OMGSKILLS_GITHUB_BROKER_TEST_PATH"
];

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppJwt({ appId, privateKey, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000) - 60;
  const unsigned = [
    encodeJson({ alg: "RS256", typ: "JWT" }),
    encodeJson({ iat: issuedAt, exp: issuedAt + 600, iss: String(appId) })
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

export function brokerConfigFromEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing broker verifier environment: ${missing.join(", ")}`);
  }

  const appId = Number(env.OMGSKILLS_GITHUB_BROKER_APP_ID);
  const installationId = Number(env.OMGSKILLS_GITHUB_BROKER_INSTALLATION_ID);
  if (!Number.isSafeInteger(appId) || appId < 1) throw new Error("Broker App ID must be a positive integer");
  if (!Number.isSafeInteger(installationId) || installationId < 1) {
    throw new Error("Broker installation ID must be a positive integer");
  }

  const allowedRepository = normalizeRepository(env.OMGSKILLS_GITHUB_BROKER_ALLOWED_REPOSITORY);
  const deniedRepository = normalizeRepository(env.OMGSKILLS_GITHUB_BROKER_DENIED_REPOSITORY);
  if (allowedRepository.toLowerCase() === deniedRepository.toLowerCase()) {
    throw new Error("Allowed and denied repositories must differ");
  }

  return {
    appId,
    installationId,
    privateKey: env.OMGSKILLS_GITHUB_BROKER_PRIVATE_KEY.replace(/\\n/g, "\n"),
    allowedRepository,
    deniedRepository,
    testPath: env.OMGSKILLS_GITHUB_BROKER_TEST_PATH.replace(/^\/+/, "")
  };
}

function normalizeRepository(value) {
  const normalized = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Invalid GitHub repository: ${value}`);
  return normalized;
}

function assertReadOnlyPermissions(permissions, label) {
  if (permissions?.contents !== "read") throw new Error(`${label} does not grant contents:read`);
  for (const [name, level] of Object.entries(permissions)) {
    if (level === "write" || level === "admin") throw new Error(`${label} grants ${name}:${level}`);
    if (!new Set(["contents", "metadata"]).has(name) && level !== "none") {
      throw new Error(`${label} grants unexpected ${name}:${level}`);
    }
  }
}

async function githubRequest(fetchImpl, path, token, options = {}) {
  const response = await fetchImpl(`${API_ORIGIN}${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": API_VERSION,
      ...options.headers
    },
    signal: AbortSignal.timeout(20_000)
  });
  return response;
}

async function requiredJson(response, label) {
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.json();
}

export async function verifyGithubBrokerApp({
  config = brokerConfigFromEnv(),
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  const appJwt = createAppJwt({ appId: config.appId, privateKey: config.privateKey, now });
  const app = await requiredJson(
    await githubRequest(fetchImpl, "/app", appJwt),
    "GitHub App lookup"
  );
  if (Number(app.id) !== config.appId) throw new Error("GitHub App ID does not match the configured App");
  assertReadOnlyPermissions(app.permissions, "GitHub App");

  const installation = await requiredJson(
    await githubRequest(fetchImpl, `/app/installations/${config.installationId}`, appJwt),
    "GitHub App installation lookup"
  );
  if (installation.repository_selection !== "selected") {
    throw new Error("Broker App installation must use selected repositories");
  }

  const allowedName = config.allowedRepository.split("/")[1];
  const tokenResponse = await requiredJson(
    await githubRequest(fetchImpl, `/app/installations/${config.installationId}/access_tokens`, appJwt, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositories: [allowedName], permissions: { contents: "read" } })
    }),
    "Installation token creation"
  );
  if (typeof tokenResponse.token !== "string" || tokenResponse.token.length < 1) {
    throw new Error("GitHub did not return an installation token");
  }
  assertReadOnlyPermissions(tokenResponse.permissions, "Installation token");

  const repositories = tokenResponse.repositories?.map((repository) => repository.full_name?.toLowerCase());
  if (!Array.isArray(repositories) || repositories.length !== 1 || repositories[0] !== config.allowedRepository.toLowerCase()) {
    throw new Error("Installation token is not restricted to the approved repository");
  }

  const expiresAt = Date.parse(tokenResponse.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 65 * 60 * 1000) {
    throw new Error("Installation token expiry is outside the expected one-hour window");
  }

  const allowedPath = `/repos/${encodeURIComponent(config.allowedRepository.split("/")[0])}/${encodeURIComponent(allowedName)}/contents/${config.testPath.split("/").map(encodeURIComponent).join("/")}`;
  const allowed = await githubRequest(fetchImpl, allowedPath, tokenResponse.token);
  if (!allowed.ok) throw new Error(`Approved repository content returned ${allowed.status}`);

  const [deniedOwner, deniedName] = config.deniedRepository.split("/");
  const denied = await githubRequest(
    fetchImpl,
    `/repos/${encodeURIComponent(deniedOwner)}/${encodeURIComponent(deniedName)}`,
    tokenResponse.token
  );
  if (denied.status !== 404) {
    throw new Error(`Unapproved private repository returned ${denied.status}; expected 404`);
  }

  return {
    appId: config.appId,
    installationId: config.installationId,
    repository: config.allowedRepository,
    expiresAt: tokenResponse.expires_at
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyGithubBrokerApp()
    .then((result) => {
      console.log(`GitHub Broker verified: App ${result.appId}, installation ${result.installationId}, ${result.repository}, expires ${result.expiresAt}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
