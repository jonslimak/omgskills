import { optionalString, requireString } from "./validation.js";

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
    source
  };
}
