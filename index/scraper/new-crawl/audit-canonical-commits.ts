import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { indexRoot } from "./shadow-path-guard.js";
import {
  buildShaCanonicalArtifact,
  shaCanonicalOptionsFromSeeds,
  type ShaCanonicalArtifact,
  type ShaCanonicalCluster,
  type ShaCanonicalConfidence,
} from "./sha-canonical.js";
import { loadTrustedSeeds } from "./seeds.js";

const DEFAULT_MAX_PER_BUCKET = 10;
const DEFAULT_MAX_MEMBERS = 100;
const QUOTA_SAFETY_BUFFER = 250;
const REQUEST_DELAY_MS = 100;
export const MINIMUM_CANONICAL_LEAD_SECONDS = 7 * 24 * 60 * 60;

type CommitRow = {
  commit?: {
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  };
};

export type CommitHistoryResponse = {
  data: CommitRow[];
  headers?: Record<string, string | number | undefined>;
};

export type CommitHistoryRequest = (input: {
  owner: string;
  repo: string;
  path: string;
  per_page: number;
  page: number;
}) => Promise<CommitHistoryResponse>;

export type CommitEvidence = {
  skillId: string;
  repo: string;
  path: string;
  status: "ok" | "no-history" | "missing" | "transient-error";
  earliestCommitAt: string | null;
  error?: string;
};

export type CommitPilotClusterResult = {
  skillMdSha: string;
  priorCanonicalSkillId: string | null;
  priorConfidence: ShaCanonicalConfidence;
  proposedCanonicalSkillId: string | null;
  result: "confirmed" | "overturned" | "resolved" | "weak-lead" | "tie" | "incomplete";
  leadSeconds: number | null;
  evidence: CommitEvidence[];
};

type PilotCluster = {
  cluster: ShaCanonicalCluster;
  skills: Skill[];
};

export type CommitPilotBucket = "trusted-candidate" | "medium" | "unresolved";

type RateLimitClient = {
  rest: {
    rateLimit: {
      get: () => Promise<{
        data: {
          resources?: { core?: { remaining?: number; reset?: number } };
          rate?: { remaining?: number; reset?: number };
        };
      }>;
    };
  };
};

function normalizeConcretePath(value: string | undefined): string | null {
  const path = (value ?? "").trim().replace(/^\/+/, "");
  if (!path || path === "__RESOLVE__") return null;
  return path;
}

function repoParts(githubUrl: string): { owner: string; repo: string } | null {
  const match = githubUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/i, "") };
}

function isClusterFetchable(cluster: ShaCanonicalCluster, skillsById: Map<string, Skill>): boolean {
  return cluster.memberSkillIds.every((id) => {
    const skill = skillsById.get(id);
    return Boolean(skill && repoParts(skill.github_url) && normalizeConcretePath(skill.skill_md_path));
  });
}

function compareClusterPriority(a: ShaCanonicalCluster, b: ShaCanonicalCluster): number {
  return b.memberSkillIds.length - a.memberSkillIds.length || a.skillMdSha.localeCompare(b.skillMdSha);
}

export function selectCommitPilotClusters(
  artifact: ShaCanonicalArtifact,
  skills: Skill[],
  options: {
    maxPerBucket?: number;
    maxMembers?: number;
    offsetPerBucket?: number;
    buckets?: CommitPilotBucket[];
  } = {},
): {
  selected: PilotCluster[];
  eligibleTrustedCandidateCount: number;
  eligibleMediumCount: number;
  eligibleUnresolvedCount: number;
  skippedMissingPathCount: number;
} {
  const maxPerBucket = options.maxPerBucket ?? DEFAULT_MAX_PER_BUCKET;
  const maxMembers = options.maxMembers ?? DEFAULT_MAX_MEMBERS;
  const offsetPerBucket = options.offsetPerBucket ?? 0;
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const bucketsToInclude = options.buckets ?? ["medium", "unresolved"];
  const bucketFor = (cluster: ShaCanonicalCluster): CommitPilotBucket | null => {
    if (cluster.confidence === "medium" && cluster.reason === "trusted-creator") return "trusted-candidate";
    if (cluster.confidence === "medium") return "medium";
    if (cluster.confidence === "unresolved") return "unresolved";
    return null;
  };
  const considered = artifact.clusters.filter((cluster) => {
    const bucket = bucketFor(cluster);
    return bucket !== null && bucketsToInclude.includes(bucket);
  });
  const fetchable = considered.filter((cluster) => isClusterFetchable(cluster, skillsById));
  const eligibleByBucket = new Map<CommitPilotBucket, ShaCanonicalCluster[]>(
    (["trusted-candidate", "medium", "unresolved"] as const).map((bucket) => [
      bucket,
      artifact.clusters
        .filter((cluster) => bucketFor(cluster) === bucket)
        .filter((cluster) => isClusterFetchable(cluster, skillsById))
        .sort(compareClusterPriority),
    ]),
  );
  const buckets = bucketsToInclude.map((bucket) => eligibleByBucket.get(bucket) ?? []);
  const selected: PilotCluster[] = [];
  let memberCount = 0;

  for (const fullBucket of buckets) {
    const bucket = fullBucket.slice(offsetPerBucket);
    let bucketCount = 0;
    for (const cluster of bucket) {
      if (bucketCount >= maxPerBucket) break;
      if (memberCount + cluster.memberSkillIds.length > maxMembers) continue;
      selected.push({
        cluster,
        skills: cluster.memberSkillIds.map((id) => skillsById.get(id)!),
      });
      memberCount += cluster.memberSkillIds.length;
      bucketCount += 1;
    }
  }

  return {
    selected,
    eligibleTrustedCandidateCount: eligibleByBucket.get("trusted-candidate")!.length,
    eligibleMediumCount: eligibleByBucket.get("medium")!.length,
    eligibleUnresolvedCount: eligibleByBucket.get("unresolved")!.length,
    skippedMissingPathCount: considered.length - fetchable.length,
  };
}

export function lastPageFromLink(link: string | undefined): number {
  if (!link) return 1;
  for (const part of link.split(",")) {
    if (!/rel="last"/.test(part)) continue;
    const urlMatch = part.match(/<([^>]+)>/);
    if (!urlMatch) continue;
    const page = Number(new URL(urlMatch[1]!).searchParams.get("page"));
    if (Number.isInteger(page) && page > 0) return page;
  }
  return 1;
}

function commitDate(row: CommitRow | undefined): string | null {
  const value = row?.commit?.author?.date ?? row?.commit?.committer?.date ?? null;
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export async function fetchEarliestCommitEvidence(
  skill: Skill,
  request: CommitHistoryRequest,
): Promise<{ evidence: CommitEvidence; requestCount: number }> {
  const repo = repoParts(skill.github_url);
  const path = normalizeConcretePath(skill.skill_md_path);
  if (!repo || !path) {
    return {
      evidence: {
        skillId: skill.id,
        repo: repo ? `${repo.owner}/${repo.repo}` : "",
        path: path ?? "",
        status: "missing",
        earliestCommitAt: null,
        error: "missing concrete repo or skill path",
      },
      requestCount: 0,
    };
  }

  let requestCount = 0;
  try {
    const first = await request({ ...repo, path, per_page: 1, page: 1 });
    requestCount += 1;
    if (first.data.length === 0) {
      return {
        evidence: {
          skillId: skill.id,
          repo: `${repo.owner}/${repo.repo}`,
          path,
          status: "no-history",
          earliestCommitAt: null,
        },
        requestCount,
      };
    }

    const lastPage = lastPageFromLink(String(first.headers?.link ?? ""));
    const earliestResponse = lastPage > 1
      ? await request({ ...repo, path, per_page: 1, page: lastPage })
      : first;
    if (lastPage > 1) requestCount += 1;
    const earliestCommitAt = commitDate(earliestResponse.data[0]);
    return {
      evidence: {
        skillId: skill.id,
        repo: `${repo.owner}/${repo.repo}`,
        path,
        status: earliestCommitAt ? "ok" : "no-history",
        earliestCommitAt,
      },
      requestCount,
    };
  } catch (error) {
    const status = errorStatus(error);
    if (status === 403 || status === 429) throw error;
    return {
      evidence: {
        skillId: skill.id,
        repo: `${repo.owner}/${repo.repo}`,
        path,
        status: status === 404 ? "missing" : "transient-error",
        earliestCommitAt: null,
        error: error instanceof Error ? error.message : String(error),
      },
      requestCount,
    };
  }
}

export function evaluateCommitEvidence(
  cluster: ShaCanonicalCluster,
  evidence: CommitEvidence[],
): CommitPilotClusterResult {
  const complete = evidence.length === cluster.memberSkillIds.length && evidence.every((row) => row.status === "ok");
  if (!complete) {
    return {
      skillMdSha: cluster.skillMdSha,
      priorCanonicalSkillId: cluster.canonicalSkillId,
      priorConfidence: cluster.confidence,
      proposedCanonicalSkillId: null,
      result: "incomplete",
      leadSeconds: null,
      evidence,
    };
  }

  const sorted = [...evidence].sort(
    (a, b) => Date.parse(a.earliestCommitAt!) - Date.parse(b.earliestCommitAt!) || a.skillId.localeCompare(b.skillId),
  );
  const leadSeconds = sorted.length === 1
    ? Number.POSITIVE_INFINITY
    : (Date.parse(sorted[1]!.earliestCommitAt!) - Date.parse(sorted[0]!.earliestCommitAt!)) / 1000;
  const hasUniqueEarliest = leadSeconds > 0;
  const hasStrongLead = leadSeconds >= MINIMUM_CANONICAL_LEAD_SECONDS;
  const proposedCanonicalSkillId = hasUniqueEarliest && hasStrongLead ? sorted[0]!.skillId : null;
  const result: CommitPilotClusterResult["result"] = !hasUniqueEarliest
    ? "tie"
    : !hasStrongLead
      ? "weak-lead"
    : cluster.confidence === "unresolved"
      ? "resolved"
      : proposedCanonicalSkillId === cluster.canonicalSkillId
        ? "confirmed"
        : "overturned";

  return {
    skillMdSha: cluster.skillMdSha,
    priorCanonicalSkillId: cluster.canonicalSkillId,
    priorConfidence: cluster.confidence,
    proposedCanonicalSkillId,
    result,
    leadSeconds,
    evidence: sorted,
  };
}

function integerArg(argv: string[], name: string, fallback: number): number {
  const raw = argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function bucketArgs(argv: string[]): CommitPilotBucket[] {
  const raw = argv.find((arg) => arg.startsWith("--buckets="));
  if (!raw) return ["medium", "unresolved"];
  const values = raw.slice("--buckets=".length).split(",").filter(Boolean);
  const allowed = new Set<CommitPilotBucket>(["trusted-candidate", "medium", "unresolved"]);
  if (values.length === 0 || values.some((value) => !allowed.has(value as CommitPilotBucket))) {
    throw new Error("--buckets must contain trusted-candidate, medium, and/or unresolved");
  }
  return [...new Set(values)] as CommitPilotBucket[];
}

async function assertPilotQuota(client: RateLimitClient, estimatedRequests: number): Promise<{
  initialRemaining: number;
  resetAt: string | null;
}> {
  const { data } = await client.rest.rateLimit.get();
  const core = data.resources?.core ?? data.rate;
  const initialRemaining = core?.remaining ?? 0;
  const required = estimatedRequests + QUOTA_SAFETY_BUFFER;
  if (initialRemaining < required) {
    const resetAt = core?.reset ? new Date(core.reset * 1000).toISOString() : "unknown";
    throw new Error(
      `GitHub core quota too low for canonical commit pilot: remaining=${initialRemaining}, required=${required}, reset=${resetAt}`,
    );
  }
  return {
    initialRemaining,
    resetAt: core?.reset ? new Date(core.reset * 1000).toISOString() : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const skills = JSON.parse(
    readFileSync(join(indexRoot, "shadow", "skills.cutover.shadow.json"), "utf8"),
  ) as Skill[];
  const artifact = buildShaCanonicalArtifact(
    skills,
    new Date().toISOString(),
    shaCanonicalOptionsFromSeeds(loadTrustedSeeds()),
  );
  const offsetPerBucket = integerArg(process.argv.slice(2), "--offset-per-bucket", 0);
  const buckets = bucketArgs(process.argv.slice(2));
  const selection = selectCommitPilotClusters(artifact, skills, { offsetPerBucket, buckets });
  const selectedMemberCount = selection.selected.reduce((sum, row) => sum + row.skills.length, 0);
  const estimatedRequests = selectedMemberCount * 2;
  const { octokit } = await import("../client.js");
  const quota = await assertPilotQuota(octokit, estimatedRequests);
  const request: CommitHistoryRequest = async (input) => {
    const response = await octokit.rest.repos.listCommits(input);
    return {
      data: response.data,
      headers: response.headers as Record<string, string | number | undefined>,
    };
  };

  let requestsMade = 0;
  const clusters: CommitPilotClusterResult[] = [];
  for (const selected of selection.selected) {
    const evidence: CommitEvidence[] = [];
    for (const skill of selected.skills) {
      if (requestsMade > 0) await sleep(REQUEST_DELAY_MS);
      const result = await fetchEarliestCommitEvidence(skill, request);
      requestsMade += result.requestCount;
      evidence.push(result.evidence);
    }
    clusters.push(evaluateCommitEvidence(selected.cluster, evidence));
  }

  const summary = {
    selectedClusterCount: clusters.length,
    selectedMemberCount,
    confirmedCount: clusters.filter((row) => row.result === "confirmed").length,
    overturnedCount: clusters.filter((row) => row.result === "overturned").length,
    resolvedCount: clusters.filter((row) => row.result === "resolved").length,
    weakLeadCount: clusters.filter((row) => row.result === "weak-lead").length,
    tieCount: clusters.filter((row) => row.result === "tie").length,
    incompleteCount: clusters.filter((row) => row.result === "incomplete").length,
  };
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    selection: {
      maxPerBucket: DEFAULT_MAX_PER_BUCKET,
      maxMembers: DEFAULT_MAX_MEMBERS,
      offsetPerBucket,
      buckets,
      minimumCanonicalLeadSeconds: MINIMUM_CANONICAL_LEAD_SECONDS,
      eligibleTrustedCandidateCount: selection.eligibleTrustedCandidateCount,
      eligibleMediumCount: selection.eligibleMediumCount,
      eligibleUnresolvedCount: selection.eligibleUnresolvedCount,
      skippedMissingPathCount: selection.skippedMissingPathCount,
    },
    quota: {
      ...quota,
      estimatedRequests,
      requestsMade,
      estimatedRemaining: quota.initialRemaining - requestsMade - 1,
    },
    summary,
    clusters,
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
