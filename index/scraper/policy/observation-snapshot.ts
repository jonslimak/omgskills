import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Candidate } from "../enrich.js";
import type { RepoBootstrapCandidate, ShadowRepoIndex, ShadowSkillRecord } from "../new-crawl/types.js";
import type { Skill } from "../types.js";

export const POLICY_OBSERVATION_SNAPSHOT_VERSION = 1;
export const DEFAULT_SNAPSHOT_FRESHNESS_HOURS = 72;

type SnapshotBase = {
  version: typeof POLICY_OBSERVATION_SNAPSHOT_VERSION;
  snapshotId: string;
  capturedAt: string;
  sourceCommit: string;
  policyDigest: string;
};

export type V2PolicyObservationSnapshot = SnapshotBase & {
  track: "v2";
  payload: {
    legacySkills: V2PolicySkillFact[];
    candidates: V2PolicyCandidateFact[];
  };
};

export type V2PolicySkillFact = Pick<Skill, "id" | "github_url" | "skill_md_path">;
export type V2PolicyCandidateFact = Pick<Candidate, "id" | "github_url" | "skill_md_path">;

export type Crawl4QualitySkillFact = Pick<
  ShadowSkillRecord,
  "id" | "github_url" | "publisher_repo" | "provenance_type" | "author_handle"
>;

export type Crawl4AdmissionFact = {
  repo: string;
  repoUrl: string;
  sources: string[];
  stars: number;
  bootstrapCandidate?: RepoBootstrapCandidate;
  bootstrapCandidates?: RepoBootstrapCandidate[];
};

export type Crawl4PolicyObservationSnapshot = SnapshotBase & {
  track: "crawl4";
  payload: {
    admissionCandidates: Crawl4AdmissionFact[];
    repoIndex: ShadowRepoIndex;
    qualitySkills: Crawl4QualitySkillFact[];
    goldBasketRepos: string[];
    goldBasketSkillIds: string[];
    installAdmissionEnabled: boolean;
    qualityTiersEnabled: boolean;
  };
};

export type PolicyObservationSnapshot =
  | V2PolicyObservationSnapshot
  | Crawl4PolicyObservationSnapshot;

type SnapshotInput =
  | Omit<V2PolicyObservationSnapshot, "snapshotId">
  | Omit<Crawl4PolicyObservationSnapshot, "snapshotId">;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function snapshotIdentityValue(input: SnapshotInput): unknown {
  if (input.track === "v2") {
    return {
      version: input.version,
      track: input.track,
      payload: input.payload,
    };
  }
  return {
    version: input.version,
    track: input.track,
    payload: {
      admissionCandidates: input.payload.admissionCandidates,
      repoFacts: input.payload.repoIndex.repos.map((repo) => ({
        repo: repo.repo,
        state: repo.state,
        discoveredSources: repo.discoveredSources,
        skillIds: repo.skillIds,
      })),
      qualitySkills: input.payload.qualitySkills,
      goldBasketRepos: input.payload.goldBasketRepos,
      goldBasketSkillIds: input.payload.goldBasketSkillIds,
      installAdmissionEnabled: input.payload.installAdmissionEnabled,
      qualityTiersEnabled: input.payload.qualityTiersEnabled,
    },
  };
}

function snapshotDigest(input: SnapshotInput): string {
  const canonical = JSON.stringify(stableValue(snapshotIdentityValue(input)));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function createPolicyObservationSnapshot(input: SnapshotInput): PolicyObservationSnapshot {
  return {
    ...input,
    snapshotId: snapshotDigest(input),
  } as PolicyObservationSnapshot;
}

export function validatePolicyObservationSnapshot(value: unknown): PolicyObservationSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Policy observation snapshot must be an object");
  }
  const snapshot = value as Partial<PolicyObservationSnapshot>;
  if (snapshot.version !== POLICY_OBSERVATION_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported policy observation snapshot version: ${String(snapshot.version)}`);
  }
  if (snapshot.track !== "v2" && snapshot.track !== "crawl4") {
    throw new Error(`Invalid policy observation snapshot track: ${String(snapshot.track)}`);
  }
  if (
    typeof snapshot.snapshotId !== "string" ||
    typeof snapshot.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
    typeof snapshot.sourceCommit !== "string" ||
    typeof snapshot.policyDigest !== "string" ||
    !snapshot.payload ||
    typeof snapshot.payload !== "object"
  ) {
    throw new Error("Policy observation snapshot metadata is incomplete");
  }
  if (snapshot.track === "v2") {
    const payload = snapshot.payload as Partial<V2PolicyObservationSnapshot["payload"]>;
    if (!Array.isArray(payload.legacySkills) || !Array.isArray(payload.candidates)) {
      throw new Error("V2 policy observation snapshot payload is incomplete");
    }
  } else {
    const payload = snapshot.payload as Partial<Crawl4PolicyObservationSnapshot["payload"]>;
    if (
      !Array.isArray(payload.admissionCandidates) ||
      !payload.repoIndex ||
      typeof payload.repoIndex !== "object" ||
      !Array.isArray(payload.qualitySkills) ||
      !Array.isArray(payload.goldBasketRepos) ||
      !Array.isArray(payload.goldBasketSkillIds) ||
      typeof payload.installAdmissionEnabled !== "boolean" ||
      typeof payload.qualityTiersEnabled !== "boolean"
    ) {
      throw new Error("Crawl 4 policy observation snapshot payload is incomplete");
    }
  }

  const { snapshotId, ...input } = snapshot as PolicyObservationSnapshot;
  const expectedId = snapshotDigest(input as SnapshotInput);
  if (snapshotId !== expectedId) {
    throw new Error(`Policy observation snapshot digest mismatch: expected ${expectedId}, received ${snapshotId}`);
  }
  return snapshot as PolicyObservationSnapshot;
}

export function readPolicyObservationSnapshot(path: string): PolicyObservationSnapshot {
  return validatePolicyObservationSnapshot(JSON.parse(readFileSync(path, "utf8")));
}

export function writePolicyObservationSnapshot(path: string, snapshot: PolicyObservationSnapshot): void {
  validatePolicyObservationSnapshot(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

export function snapshotAgeHours(snapshot: PolicyObservationSnapshot, now = new Date()): number {
  return Math.max(0, (now.getTime() - Date.parse(snapshot.capturedAt)) / 3_600_000);
}

export function snapshotFreshness(
  snapshot: PolicyObservationSnapshot,
  now = new Date(),
  maxAgeHours = DEFAULT_SNAPSHOT_FRESHNESS_HOURS,
): "fresh" | "stale" {
  return snapshotAgeHours(snapshot, now) > maxAgeHours ? "stale" : "fresh";
}
