import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DoNotCrawlRule, ShadowSkillRecord, SuppressedSkillRule } from "./types.js";
import type { PolicyReasonCode } from "../policy/types.js";

const indexRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const suppressedSkillsPath = join(indexRoot, "seeds", "suppressed-skills.json");
const doNotCrawlPath = join(indexRoot, "seeds", "do-not-crawl.json");
const shadowSkillsPath = join(indexRoot, "shadow", "skills.cutover.shadow.json");
const reportsRoot = join(indexRoot, "reports");
const reportJsonPath = join(reportsRoot, "removal-audit.json");
const reportMarkdownPath = join(reportsRoot, "removal-audit.md");

export type SuppressedSkillsSeed = {
  skills: SuppressedSkillRule[];
};

export type DoNotCrawlSeed = {
  repos?: DoNotCrawlRule[];
  owners?: DoNotCrawlRule[];
};

export type RemovalAuditBatch = {
  stagedAt: string;
  count: number;
  reasonCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  sampleIds: string[];
};

export type RemovalAuditReport = {
  generatedAt: string;
  enforcementNote: string[];
  suppressedSkillCount: number;
  reasonCounts: Record<string, number>;
  policyReasonCounts: Partial<Record<PolicyReasonCode, number>>;
  confidenceCounts: Record<string, number>;
  batchCount: number;
  batches: RemovalAuditBatch[];
  missingReplacementCount: number;
  missingReplacementCategoryCounts: Record<string, number>;
  missingReplacementIds: { id: string; replacementId: string }[];
  topRemovedRepos: { repo: string; count: number }[];
  topRemovedOwners: { owner: string; count: number }[];
  doNotCrawl: {
    repoCount: number;
    ownerCount: number;
    reasonCounts: Record<string, number>;
  };
};

function classifyMissingReplacement(entry: SuppressedSkillRule, suppressedIds: Set<string>): string {
  const replacementId = entry.replacementId ?? "";
  if (entry.id.toLowerCase() === replacementId.toLowerCase()) return "case-only-id-difference";
  if (suppressedIds.has(replacementId)) return "replacement-suppressed";
  if (skillRepo(entry.id).toLowerCase() === skillRepo(replacementId).toLowerCase()) return "same-repo-replacement-filtered";
  if (/awesome|collection|registry|catalog|ordinary-claude-skills|antigravity-skills|trending-skills/i.test(skillRepo(replacementId))) {
    return "catalog-like-replacement-filtered";
  }
  return "missing-replacement";
}

function increment(map: Record<string, number>, key: string): void {
  map[key || "unknown"] = (map[key || "unknown"] ?? 0) + 1;
}

function sortedRecord(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function skillRepo(id: string): string {
  const [repo = ""] = id.split(":");
  return repo.trim();
}

function skillOwner(id: string): string {
  return skillRepo(id).split("/")[0]?.trim() || "unknown";
}

function topCounts(counts: Record<string, number>, keyName: "repo" | "owner", limit = 20): { repo: string; count: number }[] | { owner: string; count: number }[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count })) as { repo: string; count: number }[] | { owner: string; count: number }[];
}

export function buildRemovalAuditReport(input: {
  suppressedSkills: SuppressedSkillRule[];
  doNotCrawl: DoNotCrawlSeed;
  currentSkillIds?: Set<string>;
  generatedAt: string;
}): RemovalAuditReport {
  const suppressedSkills = [...input.suppressedSkills].sort((a, b) => a.id.localeCompare(b.id));
  const reasonCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  const repoCounts: Record<string, number> = {};
  const ownerCounts: Record<string, number> = {};
  const byBatch = new Map<string, SuppressedSkillRule[]>();
  const missingReplacementIds: { id: string; replacementId: string }[] = [];
  const missingReplacementCategoryCounts: Record<string, number> = {};
  const suppressedIds = new Set(suppressedSkills.map((entry) => entry.id));

  for (const entry of suppressedSkills) {
    increment(reasonCounts, entry.reason);
    increment(confidenceCounts, entry.confidence ?? "unknown");
    increment(repoCounts, skillRepo(entry.id) || "unknown");
    increment(ownerCounts, skillOwner(entry.id));
    const batchKey = entry.stagedAt || "unknown";
    byBatch.set(batchKey, [...(byBatch.get(batchKey) ?? []), entry]);
    if (entry.replacementId && input.currentSkillIds && !input.currentSkillIds.has(entry.replacementId)) {
      missingReplacementIds.push({ id: entry.id, replacementId: entry.replacementId });
      increment(missingReplacementCategoryCounts, classifyMissingReplacement(entry, suppressedIds));
    }
  }

  const batches = [...byBatch.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stagedAt, entries]) => {
      const batchReasonCounts: Record<string, number> = {};
      const batchConfidenceCounts: Record<string, number> = {};
      for (const entry of entries) {
        increment(batchReasonCounts, entry.reason);
        increment(batchConfidenceCounts, entry.confidence ?? "unknown");
      }
      return {
        stagedAt,
        count: entries.length,
        reasonCounts: sortedRecord(batchReasonCounts),
        confidenceCounts: sortedRecord(batchConfidenceCounts),
        sampleIds: entries
          .map((entry) => entry.id)
          .sort()
          .slice(0, 10),
      };
    });

  const doNotCrawlReasonCounts: Record<string, number> = {};
  for (const rule of [...(input.doNotCrawl.repos ?? []), ...(input.doNotCrawl.owners ?? [])]) {
    increment(doNotCrawlReasonCounts, rule.reason);
  }

  missingReplacementIds.sort((a, b) => a.id.localeCompare(b.id));

  return {
    generatedAt: input.generatedAt,
    enforcementNote: [
      "suppressed-skills.json prevents skill-level duplicates from returning.",
      "do-not-crawl.json prevents blocked repos and owners from being re-crawled.",
      "removal-audit is documentation only and does not control crawler behavior.",
    ],
    suppressedSkillCount: suppressedSkills.length,
    reasonCounts: sortedRecord(reasonCounts),
    policyReasonCounts: {
      ...(suppressedSkills.length ? { "suppressed-skill": suppressedSkills.length } : {}),
      ...((input.doNotCrawl.repos?.length ?? 0) + (input.doNotCrawl.owners?.length ?? 0)
        ? { "do-not-crawl": (input.doNotCrawl.repos?.length ?? 0) + (input.doNotCrawl.owners?.length ?? 0) }
        : {}),
    },
    confidenceCounts: sortedRecord(confidenceCounts),
    batchCount: batches.length,
    batches,
    missingReplacementCount: missingReplacementIds.length,
    missingReplacementCategoryCounts: sortedRecord(missingReplacementCategoryCounts),
    missingReplacementIds: missingReplacementIds.slice(0, 50),
    topRemovedRepos: topCounts(repoCounts, "repo") as { repo: string; count: number }[],
    topRemovedOwners: topCounts(ownerCounts, "owner") as { owner: string; count: number }[],
    doNotCrawl: {
      repoCount: input.doNotCrawl.repos?.length ?? 0,
      ownerCount: input.doNotCrawl.owners?.length ?? 0,
      reasonCounts: sortedRecord(doNotCrawlReasonCounts),
    },
  };
}

export function renderRemovalAuditMarkdown(report: RemovalAuditReport): string {
  const lines: string[] = [];
  lines.push("# Crawl 4 Removal Audit");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Enforcement");
  lines.push("");
  for (const note of report.enforcementNote) lines.push(`- ${note}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Suppressed skills: ${report.suppressedSkillCount}`);
  lines.push(`- Suppression batches: ${report.batchCount}`);
  lines.push(`- Missing replacement warnings: ${report.missingReplacementCount}`);
  lines.push(`- Do-not-crawl repos: ${report.doNotCrawl.repoCount}`);
  lines.push(`- Do-not-crawl owners: ${report.doNotCrawl.ownerCount}`);
  for (const [reason, count] of Object.entries(report.policyReasonCounts)) {
    lines.push(`- Policy reason ${reason}: ${count}`);
  }
  lines.push("");
  lines.push("## Suppressions by Reason");
  lines.push("");
  for (const [reason, count] of Object.entries(report.reasonCounts)) lines.push(`- ${reason}: ${count}`);
  lines.push("");
  lines.push("## Suppressions by Confidence");
  lines.push("");
  for (const [confidence, count] of Object.entries(report.confidenceCounts)) lines.push(`- ${confidence}: ${count}`);
  lines.push("");
  lines.push("## Batches");
  lines.push("");
  for (const batch of report.batches) {
    lines.push(`### ${batch.stagedAt}`);
    lines.push("");
    lines.push(`- Count: ${batch.count}`);
    lines.push(`- Reasons: ${Object.entries(batch.reasonCounts).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`);
    lines.push(`- Confidence: ${Object.entries(batch.confidenceCounts).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`);
    lines.push(`- Sample IDs: ${batch.sampleIds.join(", ") || "none"}`);
    lines.push("");
  }
  lines.push("## Top Removed Repos");
  lines.push("");
  for (const row of report.topRemovedRepos) lines.push(`- ${row.repo}: ${row.count}`);
  lines.push("");
  lines.push("## Top Removed Owners");
  lines.push("");
  for (const row of report.topRemovedOwners) lines.push(`- ${row.owner}: ${row.count}`);
  lines.push("");
  lines.push("## Do Not Crawl");
  lines.push("");
  for (const [reason, count] of Object.entries(report.doNotCrawl.reasonCounts)) lines.push(`- ${reason}: ${count}`);
  lines.push("");
  if (report.missingReplacementIds.length > 0) {
    lines.push("## Missing Replacement Warnings");
    lines.push("");
    lines.push("These are warnings, not publish blockers. They usually mean an earlier canonical replacement was later filtered or suppressed by a stronger cleanup rule.");
    lines.push("");
    lines.push("### Categories");
    lines.push("");
    for (const [category, count] of Object.entries(report.missingReplacementCategoryCounts)) lines.push(`- ${category}: ${count}`);
    lines.push("");
    lines.push("### Samples");
    lines.push("");
    for (const warning of report.missingReplacementIds) lines.push(`- ${warning.id} -> ${warning.replacementId}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function currentSkillIds(): Set<string> | undefined {
  if (!existsSync(shadowSkillsPath)) return undefined;
  const skills = readJson<ShadowSkillRecord[]>(shadowSkillsPath);
  return new Set(skills.map((skill) => skill.id));
}

export function writeRemovalAuditReport(generatedAt = new Date().toISOString()): RemovalAuditReport {
  const suppressed = readJson<SuppressedSkillsSeed>(suppressedSkillsPath);
  const doNotCrawl = readJson<DoNotCrawlSeed>(doNotCrawlPath);
  const report = buildRemovalAuditReport({
    suppressedSkills: suppressed.skills ?? [],
    doNotCrawl,
    currentSkillIds: currentSkillIds(),
    generatedAt,
  });
  mkdirSync(reportsRoot, { recursive: true });
  writeFileSync(reportJsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(reportMarkdownPath, renderRemovalAuditMarkdown(report));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = writeRemovalAuditReport();
  console.log(`wrote ${reportJsonPath}`);
  console.log(`wrote ${reportMarkdownPath}`);
  console.log(`suppressed skills: ${report.suppressedSkillCount}`);
  console.log(`missing replacement warnings: ${report.missingReplacementCount}`);
}
