import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readPolicyObservationSnapshot,
  snapshotAgeHours,
  snapshotFreshness,
  type Crawl4AdmissionFact,
  type Crawl4PolicyObservationSnapshot,
  type V2PolicyObservationSnapshot,
} from "../scraper/policy/observation-snapshot.js";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import { effectivePolicyDigest } from "../scraper/policy/digest.js";
import { currentSourceCommit } from "../scraper/policy/metadata.js";
import { loadTrustedSeeds, resolveCreatorHandle } from "../scraper/new-crawl/seeds.js";
import {
  evaluateDiscoveredRepoAdmission,
  type AdmissionDiscoveredRepo,
  type AdmissionTrustSignals,
} from "../scraper/new-crawl/admission.js";
import {
  admissionObservation,
  applyRepoStatePrecedence,
  buildPolicyPrecedenceReport,
  renderPolicyPrecedenceReport,
  type QualityTierPolicyObservation,
} from "../scraper/new-crawl/policy-precedence.js";
import { classifySkillQualityTier } from "../scraper/new-crawl/quality-tier.js";
import type { ShadowRepoIndex, TrustedSeeds } from "../scraper/new-crawl/types.js";
import {
  buildV2LegacyMigrationAudit,
  buildV2PolicyReport,
  evaluateProposedV2Skill,
  observeCandidatePolicy,
  renderV2PolicyReport,
} from "../scraper/v2-policy.js";

type ReplayOptions = {
  snapshotPath: string;
  outputDirectory: string;
  maxAgeHours: number;
};

function parseArgs(argv: string[]): ReplayOptions {
  let snapshotPath = "";
  let outputDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "shadow");
  let maxAgeHours = 72;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--snapshot") snapshotPath = argv[++index] ?? "";
    else if (argument === "--output-dir") outputDirectory = resolve(argv[++index] ?? "");
    else if (argument === "--max-age-hours") maxAgeHours = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!snapshotPath) throw new Error("--snapshot is required");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("--max-age-hours must be a positive number");
  }
  return { snapshotPath: resolve(snapshotPath), outputDirectory, maxAgeHours };
}

function currentPolicy() {
  const loaded = loadPolicySources();
  return {
    digest: effectivePolicyDigest(typedPolicySources(loaded)),
    seeds: loadTrustedSeeds("manual-command"),
  };
}

function writeReport(outputDirectory: string, basename: string, report: unknown, markdown: string): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [path, content] of [
    [join(outputDirectory, `${basename}.json`), `${JSON.stringify(report, null, 2)}\n`],
    [join(outputDirectory, `${basename}.md`), markdown],
  ] as const) {
    const temporaryPath = `${path}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, content);
    renameSync(temporaryPath, path);
  }
}

function admissionFact(fact: Crawl4AdmissionFact): AdmissionDiscoveredRepo {
  return {
    repo: fact.repo,
    repoUrl: fact.repoUrl,
    sources: new Set(fact.sources),
    stars: fact.stars,
    bootstrapCandidate: fact.bootstrapCandidate,
    bootstrapCandidates: fact.bootstrapCandidates,
  };
}

function ownerHandle(repo: string): string {
  return repo.split("/")[0]?.toLowerCase() ?? "";
}

function trustSignals(
  repo: string,
  seeds: TrustedSeeds,
  goldBasketRepos: ReadonlySet<string>,
): AdmissionTrustSignals {
  const owner = resolveCreatorHandle(seeds, ownerHandle(repo));
  return {
    isTrustedVendor: seeds.trustedVendorHandles.has(owner),
    isTrustedCreator: seeds.trustedCreatorHandles.has(owner),
    isGoldBasketRepo: goldBasketRepos.has(repo),
  };
}

function cloneRepoIndex(repoIndex: ShadowRepoIndex): ShadowRepoIndex {
  return structuredClone(repoIndex);
}

function replayCrawl4(
  snapshot: Crawl4PolicyObservationSnapshot,
  seeds: TrustedSeeds,
  policyDigest: string,
) {
  const goldBasketRepos = new Set(snapshot.payload.goldBasketRepos);
  const admissions = snapshot.payload.admissionCandidates.flatMap((fact) => {
    const discovered = admissionFact(fact);
    const evaluation = evaluateDiscoveredRepoAdmission(
      discovered,
      seeds,
      trustSignals(discovered.repo, seeds, goldBasketRepos),
      {
        installAdmissionEnabled: snapshot.payload.installAdmissionEnabled,
        policyPrecedenceMode: "observe",
      },
    );
    const observation = admissionObservation(discovered.repo, evaluation);
    return observation ? [observation] : [];
  });

  const repoIndex = cloneRepoIndex(snapshot.payload.repoIndex);
  const repoStates = applyRepoStatePrecedence(repoIndex, seeds, false);
  const goldBasketSkillIds = new Set(snapshot.payload.goldBasketSkillIds);
  const repoBySkillId = new Map(
    repoIndex.repos.flatMap((repo) => repo.skillIds.map((skillId) => [skillId, repo] as const)),
  );
  const qualityTiers: QualityTierPolicyObservation[] = snapshot.payload.qualityTiersEnabled
    ? snapshot.payload.qualitySkills.flatMap((skill) => {
    const repo = repoBySkillId.get(skill.id) ?? null;
    const currentTier = classifySkillQualityTier({
      skill,
      repo,
      seeds,
      goldBasketSkillIds,
    });
    const proposedTier = classifySkillQualityTier({
      skill,
      repo,
      seeds,
      goldBasketSkillIds,
      enforcePolicyPrecedence: true,
    });
    if (currentTier === proposedTier) return [];
    return [{
      skillId: skill.id,
      currentTier,
      proposedTier,
      reasonCode: "non-original-provenance" as const,
    }];
  }) : [];

  return buildPolicyPrecedenceReport({
    generatedAt: snapshot.capturedAt,
    sourceCommit: currentSourceCommit(),
    policyDigest,
    mode: "observe",
    admissions,
    repoStates,
    qualityTiers,
    snapshotId: snapshot.snapshotId,
    snapshotCapturedAt: snapshot.capturedAt,
    snapshotSourceCommit: snapshot.sourceCommit,
  });
}

function replayV2(
  snapshot: V2PolicyObservationSnapshot,
  seeds: TrustedSeeds,
  policyDigest: string,
) {
  const proposedSkills = snapshot.payload.legacySkills.filter(
    (skill) => !evaluateProposedV2Skill(skill, seeds).excluded,
  );
  const candidateObservations = snapshot.payload.candidates.flatMap((candidate) => {
    const observation = observeCandidatePolicy(candidate, seeds);
    return observation ? [observation] : [];
  });
  return buildV2PolicyReport({
    generatedAt: snapshot.capturedAt,
    mode: "observe",
    sourceCommit: currentSourceCommit(),
    policyDigest,
    legacySkills: snapshot.payload.legacySkills,
    proposedSkills,
    candidateObservations,
    migration: buildV2LegacyMigrationAudit(seeds),
    seeds,
    snapshotId: snapshot.snapshotId,
    snapshotCapturedAt: snapshot.capturedAt,
    snapshotSourceCommit: snapshot.sourceCommit,
  });
}

export function replayPolicyObservation(options: ReplayOptions): {
  track: "v2" | "crawl4";
  reportPath: string;
  freshness: "fresh" | "stale";
} {
  const snapshot = readPolicyObservationSnapshot(options.snapshotPath);
  const policy = currentPolicy();
  const freshness = snapshotFreshness(snapshot, new Date(), options.maxAgeHours);
  const ageHours = snapshotAgeHours(snapshot);
  if (freshness === "stale") {
    console.warn(
      `[policy:replay] warning: snapshot is ${ageHours.toFixed(1)} hours old; ` +
      "use it for regression analysis, not readiness evidence",
    );
  }

  if (snapshot.track === "v2") {
    const report = replayV2(snapshot, policy.seeds, policy.digest);
    writeReport(options.outputDirectory, "v2-policy-diff.replay", report, renderV2PolicyReport(report));
    return {
      track: snapshot.track,
      reportPath: join(options.outputDirectory, "v2-policy-diff.replay.json"),
      freshness,
    };
  }

  const report = replayCrawl4(snapshot, policy.seeds, policy.digest);
  writeReport(
    options.outputDirectory,
    "policy-precedence.replay",
    report,
    renderPolicyPrecedenceReport(report),
  );
  return {
    track: snapshot.track,
    reportPath: join(options.outputDirectory, "policy-precedence.replay.json"),
    freshness,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = replayPolicyObservation(parseArgs(process.argv.slice(2)));
    console.log(`[policy:replay] ${result.track} ${result.freshness}: ${result.reportPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
