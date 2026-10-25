import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCreatorRegistry, normalizeCreatorHandle, type CreatorRegistrySource } from "../creator-registry.js";
import type { CollectionsPolicySource } from "../policy/types.js";

export const DIRECTORY_REVIEW_BATCHES = [
  "directory3000-20261023",
  "directory4500-20261024",
  "directory6000-20261024",
] as const;

type ReviewSkill = {
  id: string;
  name: string;
  author_handle: string;
  description?: string;
  stars?: number;
  github_url?: string;
  provenance_type?: string;
};
type ImportBatch = { name: string; addedSkills: { id: string }[] };
type ReviewExclusion = { handle: string; evidenceUrl: string; notes: string };

export function buildDirectoryCreatorsReview(input: {
  creators: CreatorRegistrySource;
  collections: CollectionsPolicySource;
  skills: ReviewSkill[];
  batches: ImportBatch[];
  generatedAt: string;
  singleSkillIndividuals?: ReviewExclusion[];
}) {
  const registry = buildCreatorRegistry(input.creators);
  const canonical = (value: string) => {
    const normalized = normalizeCreatorHandle(value);
    return registry.aliasToCanonical.get(normalized) ?? normalized;
  };
  const entries = new Map(registry.entries.map(entry => [normalizeCreatorHandle(entry.handle), entry]));
  const skillsById = new Map(input.skills.map(skill => [skill.id, skill]));
  if (skillsById.size !== input.skills.length) throw new Error("Catalog contains duplicate skill IDs");
  const importedIds = new Set(input.batches.flatMap(batch => batch.addedSkills.map(skill => skill.id)));
  const missingSkillIds = [...importedIds].filter(id => !skillsById.has(id)).sort();
  const importedByCreator = new Map<string, ReviewSkill[]>();
  const unattributedSkillIds: string[] = [];
  for (const id of [...importedIds].sort()) {
    const skill = skillsById.get(id);
    if (!skill) continue;
    const handle = canonical(skill.author_handle);
    if (!handle) { unattributedSkillIds.push(id); continue; }
    const group = importedByCreator.get(handle) ?? [];
    group.push(skill);
    importedByCreator.set(handle, group);
  }
  const allByCreator = new Map<string, ReviewSkill[]>();
  for (const skill of input.skills) {
    const handle = canonical(skill.author_handle);
    if (!importedByCreator.has(handle)) continue;
    const group = allByCreator.get(handle) ?? [];
    group.push(skill);
    allByCreator.set(handle, group);
  }
  const allCreators = [...importedByCreator].sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, imported]) => {
    const entry = entries.get(key);
    const all = allByCreator.get(key) ?? [];
    const handle = entry?.handle ?? imported[0].author_handle;
    const overrideMatches = Object.entries(input.collections.authorOverrides ?? {})
      .filter(([handle]) => canonical(handle) === key);
    const editorial = overrideMatches.find(([handle]) => normalizeCreatorHandle(handle) === key)?.[1]
      ?? overrideMatches[0]?.[1];
    const sample = [...all].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.id.localeCompare(b.id, "en")).slice(0, 5);
    return {
      handle,
      aliases: [...(entry?.aliases ?? [])].sort(),
      registered: Boolean(entry),
      watched: entry?.watch ?? false,
      alreadyFeatured: entry?.featured ?? false,
      suggestedAction: entry?.featured ? "preserve-existing-profile" : "review-for-featured",
      importedSkillCount: imported.length,
      totalPublishedSkillCount: all.length,
      importedSkillIds: imported.map(skill => skill.id).sort(),
      allPublishedSkillIds: all.map(skill => skill.id).sort(),
      sampleSkills: sample.map(skill => ({ id: skill.id, name: skill.name, description: skill.description ?? "" })),
      githubUrl: `https://github.com/${handle}`,
      repositoryUrls: [...new Set(imported.map(skill => skill.github_url).filter((url): url is string => Boolean(url)))].sort(),
      provenanceCounts: Object.fromEntries([...new Set(imported.map(skill => skill.provenance_type ?? "unknown"))].sort()
        .map(type => [type, imported.filter(skill => (skill.provenance_type ?? "unknown") === type).length])),
      editorial: {
        title: editorial?.title ?? null,
        subtitle: editorial?.subtitle ?? null,
        description: editorial?.description ?? null,
        xUrl: editorial?.xUrl ?? null,
        isCompany: editorial?.isCompany ?? null,
        featuredSkillIds: [...(editorial?.featuredSkillIds ?? [])],
        matchedOverrideKeys: overrideMatches.map(([handle]) => handle).sort(),
      },
      needsReview: {
        classification: editorial?.isCompany === undefined,
        description: !editorial?.description?.trim(),
        xProfile: true,
        conflictingOverrides: overrideMatches.length > 1,
      },
    };
  });
  const reviewedIndividuals = new Map((input.singleSkillIndividuals ?? []).map(entry => [canonical(entry.handle), entry]));
  const excludedSingleSkillIndividuals = allCreators.filter(entry => entry.totalPublishedSkillCount === 1
    && entry.editorial.isCompany !== true
    && (entry.editorial.isCompany === false || reviewedIndividuals.has(canonical(entry.handle))));
  const excludedHandles = new Set(excludedSingleSkillIndividuals.map(entry => entry.handle));
  const creators = allCreators.filter(entry => !excludedHandles.has(entry.handle));
  const missingRegistryHandles = allCreators.filter(entry => !entry.registered).map(entry => entry.handle);
  const featuredCount = registry.entries.filter(entry => entry.featured).length;
  const newlyFeatured = creators.filter(entry => !entry.alreadyFeatured).length;
  return {
    version: 1,
    generatedAt: input.generatedAt,
    sources: [...input.batches].sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map(batch => ({ name: batch.name, listedSkills: batch.addedSkills.length })),
    notes: [
      "Review only. This report does not change registry, collections, crawl coverage, or published data.",
      "Repeated batch IDs are deduplicated; creators are matched by catalog author and registry aliases, never inferred from a publisher repository.",
      "All published skill IDs are listed for review, not copied into the featured-highlights list.",
      "Descriptions and X links are existing editorial data only; no external identity/link verification has been performed.",
      "Unknown company classifications stay pending. GitHub organizations and directory listings do not establish company status or broad vendor trust.",
      "Confirmed individuals with exactly one total published skill are excluded from this review only; companies and unclassified accounts remain. No catalog or watch entries are removed.",
    ],
    summary: {
      importedSkillCount: importedIds.size,
      matchedImportedSkillCount: importedIds.size - missingSkillIds.length,
      creatorCount: creators.length,
      excludedSingleSkillIndividualCount: excludedSingleSkillIndividuals.length,
      existingFeaturedCount: creators.filter(entry => entry.alreadyFeatured).length,
      proposedNewFeaturedCount: newlyFeatured,
      currentFeaturedCount: featuredCount,
      proposedTotalCollections: featuredCount + newlyFeatured + input.collections.collections.length,
      missingSkillIds,
      unattributedSkillIds,
      missingRegistryHandles,
      needsClassification: creators.filter(entry => entry.needsReview.classification).length,
      needsDescription: creators.filter(entry => entry.needsReview.description).length,
      xProfilesRequiringVerification: creators.length,
      readyForEditorialReview: !missingSkillIds.length && !unattributedSkillIds.length && !missingRegistryHandles.length,
    },
    creators,
    excludedSingleSkillIndividuals: excludedSingleSkillIndividuals.map(entry => ({
      handle: entry.handle,
      reason: "individual-with-one-published-skill",
      skillIds: entry.allPublishedSkillIds,
      evidenceUrl: reviewedIndividuals.get(canonical(entry.handle))?.evidenceUrl ?? entry.githubUrl,
      notes: reviewedIndividuals.get(canonical(entry.handle))?.notes ?? "Existing editorial classification identifies an individual.",
    })),
  };
}

export function renderDirectoryCreatorsReview(report: ReturnType<typeof buildDirectoryCreatorsReview>): string {
  const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const s = report.summary;
  return [
    "# Directory Creators: Editorial Review", "",
    `Generated: ${report.generatedAt}`, "",
    `- Imported skills: ${s.importedSkillCount}; catalog matches: ${s.matchedImportedSkillCount}.`,
    `- Creators: ${s.creatorCount}; already featured: ${s.existingFeaturedCount}; candidates: ${s.proposedNewFeaturedCount}.`,
    `- Excluded from review: ${s.excludedSingleSkillIndividualCount} confirmed individuals with one total published skill.`,
    `- Proposed total collections, if all approved: ${s.proposedTotalCollections}.`,
    `- Classification pending: ${s.needsClassification}; descriptions missing: ${s.needsDescription}; X links require verification: ${s.xProfilesRequiringVerification}.`,
    `- Missing skill IDs: ${s.missingSkillIds.length}; missing registry entries: ${s.missingRegistryHandles.length}; unattributed skills: ${s.unattributedSkillIds.length}.`,
    "", ...report.notes.map(note => `- ${note}`), "",
    "| Creator | Imported / All Skills | Current Status | Classification | Description | X Profile |",
    "|---|---:|---|---|---|---|",
    ...report.creators.map(entry => `| [${cell(entry.handle)}](${entry.githubUrl}) | ${entry.importedSkillCount} / ${entry.totalPublishedSkillCount} | ${entry.alreadyFeatured ? "Preserve existing" : "Review for featured"} | ${entry.editorial.isCompany === null ? "Needs review" : entry.editorial.isCompany ? "Company" : "Creator"} | ${entry.editorial.description ? cell(entry.editorial.description) : "Needs research"} | ${entry.editorial.xUrl ? `${cell(entry.editorial.xUrl)} (verify)` : "Unknown; do not guess"} |`),
    "", "Exact imported/all skill IDs, repository links, and sample skill descriptions are in the matching JSON report.", "",
    "## Excluded From Featured Review", "",
    ...report.excludedSingleSkillIndividuals.map(entry => `- [${cell(entry.handle)}](${entry.evidenceUrl}): one published skill; ${cell(entry.notes)}`), "",
  ].join("\n");
}

export function writeDirectoryCreatorsReview(indexRoot: string, generatedAt = new Date().toISOString()) {
  const read = (path: string) => JSON.parse(readFileSync(join(indexRoot, path), "utf8"));
  const batches = DIRECTORY_REVIEW_BATCHES.map(name => {
    const path = `reports/${name}/summary.json`;
    if (!existsSync(join(indexRoot, path))) throw new Error(`Missing completed import batch: ${path}`);
    return { name, addedSkills: read(path).addedSkills };
  });
  const decisionsPath = "reports/directory-creators-review/review-decisions.json";
  const singleSkillIndividuals = existsSync(join(indexRoot, decisionsPath)) ? read(decisionsPath).singleSkillIndividuals : [];
  const report = buildDirectoryCreatorsReview({ creators: read("seeds/creators.json"), collections: read("curations/collections.json"),
    skills: read("skills.json"), batches, generatedAt, singleSkillIndividuals });
  const output = join(indexRoot, "reports", "directory-creators-review");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "review.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(output, "review.md"), renderDirectoryCreatorsReview(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const indexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = writeDirectoryCreatorsReview(indexRoot);
  console.log(JSON.stringify(report.summary, null, 2));
  if (!report.summary.readyForEditorialReview) process.exitCode = 1;
}
