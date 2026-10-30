import { optionalString, requireString } from "./validation.js";
import { parseReconciliationFields, type ReconciliationInput } from "./inventory-reconciliation.js";

export type SyncSkill = {
  stableKey: string;
  skillMdSha: string | null;
  identityStatus: "resolved" | "ambiguous" | "localOnly";
  name: string;
  description: string | null;
  catalogSkillId: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
  source: string;
  gitRelativePath?: string | null;
  catalogSkillIdHint?: string | null;
  installedFromSet?: string | null;
};

export function locationStableKey(source: string, installationPath: string): string {
  return `location:v1:${source.trim().toLowerCase()}:${installationPath}`;
}

function parseIdentity(
  value: unknown,
  catalogSkillId: string | null,
  legacyIsLocalOnly: boolean,
  usesLocationIdentity: boolean
): Pick<SyncSkill, "identityStatus" | "catalogSkillId" | "isLocalOnly"> {
  const hasExplicitStatus = value !== undefined && value !== null;
  if (
    hasExplicitStatus &&
    value !== "resolved" &&
    value !== "ambiguous" &&
    value !== "localOnly"
  ) {
    throw new Response("identityStatus is invalid", { status: 400 });
  }

  let identityStatus: SyncSkill["identityStatus"] = hasExplicitStatus
    ? (value as SyncSkill["identityStatus"])
    : catalogSkillId
      ? "resolved"
      : legacyIsLocalOnly
        ? "localOnly"
        : "ambiguous";

  const hasConsistentCatalogIdentity =
    (identityStatus === "resolved" && catalogSkillId !== null) ||
    (identityStatus !== "resolved" && catalogSkillId === null);

  if (usesLocationIdentity && !hasConsistentCatalogIdentity) {
    throw new Response("identityStatus and catalogSkillId are inconsistent", { status: 400 });
  }

  if (!usesLocationIdentity && identityStatus === "resolved" && !catalogSkillId) {
    identityStatus = "ambiguous";
  }

  return {
    identityStatus,
    catalogSkillId: identityStatus === "resolved" ? catalogSkillId : null,
    isLocalOnly: identityStatus === "localOnly"
  };
}

export function parseSyncSkill(value: unknown): SyncSkill {
  if (!value || typeof value !== "object") {
    throw new Response("Each skill must be an object", { status: 400 });
  }

  const record = value as Record<string, unknown>;
  const name = requireString(record.name, "name", 200);
  const source = requireString(record.source, "source", 40);
  const githubUrl = optionalString(record.githubUrl, 500);
  const catalogSkillId = optionalString(record.catalogSkillId, 500);
  const submittedStableKey = requireString(record.stableKey, "stableKey", 1000);
  const installationPath = optionalString(record.installationPath, 500);
  const usesLocationIdentity = installationPath !== null;

  let stableKey: string;
  if (installationPath) {
    if (
      installationPath === "." ||
      installationPath === ".." ||
      installationPath.includes("/")
    ) {
      throw new Response("installationPath must be one folder name", { status: 400 });
    }
    stableKey = locationStableKey(source, installationPath);
    if (submittedStableKey !== stableKey) {
      throw new Response("stableKey does not match the installation location", { status: 400 });
    }
  } else {
    if (submittedStableKey.startsWith("location:v1:")) {
      throw new Response("installationPath is required for location keys", { status: 400 });
    }
    // Compatibility for clients released before location-based keys.
    stableKey = githubUrl ? `${githubUrl}#${name}` : submittedStableKey;
  }

  const identity = parseIdentity(
    record.identityStatus,
    catalogSkillId,
    record.isLocalOnly === true,
    usesLocationIdentity
  );

  return {
    stableKey,
    skillMdSha: optionalString(record.skillMdSha, 80),
    identityStatus: identity.identityStatus,
    name,
    description: optionalString(record.description, 2000),
    catalogSkillId: identity.catalogSkillId,
    githubUrl,
    isLocalOnly: identity.isLocalOnly,
    ...(Object.hasOwn(record, "installedFromSet") ? { installedFromSet: optionalString(record.installedFromSet, 200) } : {}),
    source
  };
}

const unsafePathCharacters = /[\\/\u0000-\u001f\u007f]/;

export function installationFolderFromKey(key: string, source: string): string | null {
  const prefix = locationStableKey(source, "");
  if (!key.startsWith(prefix)) return null;
  const folder = key.slice(prefix.length);
  return folder && folder.length <= 500 && folder !== "." && folder !== ".."
    && !unsafePathCharacters.test(folder) ? folder : null;
}

export function parsePresenceSkill(value: unknown): SyncSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Response("Each skill must be an object", { status: 400 });
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "source", "installationPath", "name", "description", "skillMdSha",
    "githubUrl", "gitRelativePath", "catalogSkillIdHint", "installedFromSet"
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Response("Unsupported presence skill field", { status: 400 });
  }
  const source = requireString(record.source, "source", 40);
  if (!["claude", "codex", "agents"].includes(source)) {
    throw new Response("source is invalid", { status: 400 });
  }
  const folder = requireString(record.installationPath, "installationPath", 500);
  // Keep the actual filesystem name: trimming would merge distinct locations.
  if (folder !== record.installationPath || !installationFolderFromKey(locationStableKey(source, folder), source)) {
    throw new Response("installationPath must be one folder name", { status: 400 });
  }
  const skillMdSha = optionalString(record.skillMdSha, 80);
  if (skillMdSha && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(skillMdSha)) {
    throw new Response("skillMdSha is invalid", { status: 400 });
  }
  let githubUrl = optionalString(record.githubUrl, 500);
  if (githubUrl) {
    let url: URL;
    try { url = new URL(githubUrl); } catch {
      throw new Response("githubUrl is invalid", { status: 400 });
    }
    const match = /^\/([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
      || url.username || url.password || url.search || url.hash || !match
      || [".", ".."].includes(match[2])) {
      throw new Response("githubUrl must be a credential-free GitHub repository URL", { status: 400 });
    }
    githubUrl = `https://github.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
  }
  let gitRelativePath: string | null = null;
  if (record.gitRelativePath !== undefined && record.gitRelativePath !== null) {
    if (typeof record.gitRelativePath !== "string" || record.gitRelativePath.length > 500) {
      throw new Response("gitRelativePath is invalid", { status: 400 });
    }
    gitRelativePath = record.gitRelativePath;
    if (gitRelativePath === ".") gitRelativePath = "";
    if (gitRelativePath && (gitRelativePath !== gitRelativePath.trim()
      || /[\\\u0000-\u001f\u007f]/.test(gitRelativePath)
      || /^[a-z]:/i.test(gitRelativePath)
      || gitRelativePath.split("/").some((part) => !part || part === "." || part === ".."))) {
      throw new Response("gitRelativePath must be repository-relative", { status: 400 });
    }
  }
  const catalogSkillIdHint = optionalString(record.catalogSkillIdHint, 500);
  const hasSource = Boolean(githubUrl || catalogSkillIdHint);
  return {
    stableKey: locationStableKey(source, folder),
    source,
    name: requireString(record.name, "name", 200),
    description: optionalString(record.description, 2000),
    skillMdSha: skillMdSha?.toLowerCase() ?? null,
    githubUrl,
    gitRelativePath,
    catalogSkillIdHint,
    ...(Object.hasOwn(record, "installedFromSet") ? { installedFromSet: optionalString(record.installedFromSet, 200) } : {}),
    catalogSkillId: null,
    identityStatus: hasSource ? "ambiguous" : "localOnly",
    isLocalOnly: !hasSource
  };
}

export function parseSyncReport(body: Record<string, unknown>) {
  const reportVersion = body.reportVersion === undefined ? 1 : body.reportVersion;
  if (body.reportVersion !== undefined && body.reportVersion !== 2 && body.reportVersion !== 3) {
    throw new Response("Unsupported reportVersion", { status: 400 });
  }
  if (reportVersion === 2 && Object.keys(body).some((key) => !["reportVersion", "skills"].includes(key))) {
    throw new Response("Unsupported presence report field", { status: 400 });
  }
  if (reportVersion === 3 && Object.keys(body).some(key => !["reportVersion", "baseRevision", "roots", "skills"].includes(key))) {
    throw new Response("Unsupported reconciliation report field", { status: 400 });
  }
  const reconciliation = reportVersion === 3 ? parseReconciliationFields(body) : undefined;
  if (!Array.isArray(body.skills) || body.skills.length > 1000) {
    throw new Response("skills must be an array of at most 1000 entries", { status: 400 });
  }
  const skills = body.skills.map(reportVersion === 1 ? parseSyncSkill : parsePresenceSkill);
  if (new Set(skills.map((skill) => skill.stableKey)).size !== skills.length) {
    throw new Response("skills contain duplicate installation locations", { status: 400 });
  }
  return { reportVersion, skills, ...(reconciliation ? { reconciliation } : {}) } as {
    reportVersion: 1 | 2 | 3; skills: SyncSkill[]; reconciliation?: ReconciliationInput
  };
}
