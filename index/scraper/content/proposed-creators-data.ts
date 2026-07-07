export type CreatorRegistryLike = {
  creators?: {
    handle: string;
    aliases?: string[];
  }[];
};

export type GoldBasketSkillLike = {
  id: string;
  name?: string;
  author_handle: string;
  stars?: number;
};

export type AuthorLeaderboardRowLike = {
  authorHandle: string;
  stats?: {
    skillCount?: number;
    totalStars?: number;
    goldBasketCount?: number;
    totalInstalls?: number;
    editorialScore?: number;
    editorialScoreReasons?: string[];
    bestSkill?: { id?: string; name?: string; stars?: number };
  };
};

export type ShadowReportLike = {
  creatorWatchAdmissionSample?: { repo?: string; candidateId?: string }[];
  bootstrappedRepoSample?: { repo?: string; candidateId?: string; source?: string }[];
};

export type ProposedCreator = {
  handle: string;
  suggestedAction: "review-for-watch";
  score: number;
  reasons: string[];
  skillCount: number;
  goldBasketCount: number;
  totalStars: number;
  totalInstalls: number;
  sampleSkillIds: string[];
};

export type ProposedCreatorsReport = {
  generatedAt: string;
  candidateCount: number;
  candidates: ProposedCreator[];
};

const DEFAULT_EXCLUDED_HANDLES = new Set(["clawdbot", "sickn33", "majiayu000", "aiskillstore", "boisenoise", "diegosouzapw"]);

function normalizeHandle(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function registeredCreatorHandleSet(registry: CreatorRegistryLike): Set<string> {
  const handles = new Set<string>();
  for (const entry of registry.creators ?? []) {
    const handle = normalizeHandle(entry.handle);
    if (handle) handles.add(handle);
    for (const alias of entry.aliases ?? []) {
      const normalized = normalizeHandle(alias);
      if (normalized) handles.add(normalized);
    }
  }
  return handles;
}

function scoreCandidate(input: {
  skillCount: number;
  goldBasketCount: number;
  totalStars: number;
  totalInstalls: number;
  hasRecentBootstrapEvidence: boolean;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (input.goldBasketCount > 0) {
    score += 50 + input.goldBasketCount * 5;
    reasons.push(`${input.goldBasketCount} gold-basket skill${input.goldBasketCount === 1 ? "" : "s"}`);
  }
  if (input.totalStars >= 10_000) {
    score += 25;
    reasons.push("10k+ total stars");
  } else if (input.totalStars >= 1_000) {
    score += 15;
    reasons.push("1k+ total stars");
  } else if (input.totalStars >= 500) {
    score += 10;
    reasons.push("500+ total stars");
  }
  if (input.skillCount >= 10) {
    score += 12;
    reasons.push("10+ skills");
  } else if (input.skillCount >= 3) {
    score += 6;
    reasons.push("3+ skills");
  }
  if (input.totalInstalls >= 1_000) {
    score += 12;
    reasons.push("1k+ installs");
  } else if (input.totalInstalls > 0) {
    score += 4;
    reasons.push("install signal");
  }
  if (input.hasRecentBootstrapEvidence) {
    score += 8;
    reasons.push("recent Crawl 4 bootstrap evidence");
  }

  return { score, reasons };
}

export function buildProposedCreatorsReport(input: {
  generatedAt: string;
  registry: CreatorRegistryLike;
  goldBasket: GoldBasketSkillLike[];
  authorLeaderboards: AuthorLeaderboardRowLike[];
  shadowReport?: ShadowReportLike;
  limit?: number;
}): ProposedCreatorsReport {
  const registered = registeredCreatorHandleSet(input.registry);
  for (const handle of DEFAULT_EXCLUDED_HANDLES) registered.add(handle);
  const goldByHandle = new Map<string, GoldBasketSkillLike[]>();

  for (const skill of input.goldBasket) {
    const handle = normalizeHandle(skill.author_handle);
    if (!handle || registered.has(handle)) continue;
    const skills = goldByHandle.get(handle) ?? [];
    skills.push(skill);
    goldByHandle.set(handle, skills);
  }

  const recentBootstrapHandles = new Set<string>();
  for (const sample of input.shadowReport?.bootstrappedRepoSample ?? []) {
    const owner = normalizeHandle(sample.repo?.split("/")[0]);
    if (owner) recentBootstrapHandles.add(owner);
    const candidateOwner = normalizeHandle(sample.candidateId?.split("/")[0]);
    if (candidateOwner) recentBootstrapHandles.add(candidateOwner);
  }
  for (const sample of input.shadowReport?.creatorWatchAdmissionSample ?? []) {
    const owner = normalizeHandle(sample.repo?.split("/")[0]);
    if (owner) recentBootstrapHandles.add(owner);
    const candidateOwner = normalizeHandle(sample.candidateId?.split("/")[0]);
    if (candidateOwner) recentBootstrapHandles.add(candidateOwner);
  }

  const byHandle = new Map<string, ProposedCreator>();
  for (const row of input.authorLeaderboards) {
    const handle = normalizeHandle(row.authorHandle);
    if (!handle || registered.has(handle)) continue;

    const stats = row.stats ?? {};
    const goldSkills = goldByHandle.get(handle) ?? [];
    const goldBasketCount = Math.max(stats.goldBasketCount ?? 0, goldSkills.length);
    const skillCount = stats.skillCount ?? 0;
    const totalStars = stats.totalStars ?? 0;
    const totalInstalls = stats.totalInstalls ?? 0;
    const sampleSkillIds = unique([
      ...goldSkills.map((skill) => skill.id),
      stats.bestSkill?.id ?? "",
    ]).slice(0, 5);

    const fallback = scoreCandidate({
      skillCount,
      goldBasketCount,
      totalStars,
      totalInstalls,
      hasRecentBootstrapEvidence: recentBootstrapHandles.has(handle),
    });
    const score = typeof stats.editorialScore === "number" ? stats.editorialScore : fallback.score;
    const reasons = stats.editorialScoreReasons?.length ? stats.editorialScoreReasons : fallback.reasons;

    if (score <= 0) continue;
    byHandle.set(handle, {
      handle,
      suggestedAction: "review-for-watch",
      score,
      reasons,
      skillCount,
      goldBasketCount,
      totalStars,
      totalInstalls,
      sampleSkillIds,
    });
  }

  for (const [handle, goldSkills] of goldByHandle) {
    if (byHandle.has(handle)) continue;
    const totalStars = goldSkills.reduce((sum, skill) => sum + (skill.stars ?? 0), 0);
    const { score, reasons } = scoreCandidate({
      skillCount: goldSkills.length,
      goldBasketCount: goldSkills.length,
      totalStars,
      totalInstalls: 0,
      hasRecentBootstrapEvidence: recentBootstrapHandles.has(handle),
    });
    byHandle.set(handle, {
      handle,
      suggestedAction: "review-for-watch",
      score,
      reasons,
      skillCount: goldSkills.length,
      goldBasketCount: goldSkills.length,
      totalStars,
      totalInstalls: 0,
      sampleSkillIds: goldSkills.map((skill) => skill.id).slice(0, 5),
    });
  }

  const candidates = [...byHandle.values()]
    .sort((a, b) => {
      return (
        b.score - a.score ||
        b.goldBasketCount - a.goldBasketCount ||
        b.totalStars - a.totalStars ||
        b.skillCount - a.skillCount ||
        a.handle.localeCompare(b.handle)
      );
    })
    .slice(0, input.limit ?? 50);

  return {
    generatedAt: input.generatedAt,
    candidateCount: candidates.length,
    candidates,
  };
}

export function formatProposedCreatorsMarkdown(report: ProposedCreatorsReport): string {
  const lines = [
    "# Proposed Creators",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Candidates: ${report.candidateCount}`,
    "",
    "| Handle | Score | Reasons | Skills | Gold | Stars | Installs | Samples |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const candidate of report.candidates) {
    lines.push(
      [
        `\`${candidate.handle}\``,
        candidate.score,
        candidate.reasons.join(", "),
        candidate.skillCount,
        candidate.goldBasketCount,
        candidate.totalStars,
        candidate.totalInstalls,
        candidate.sampleSkillIds.map((id) => `\`${id}\``).join("<br>"),
      ].join(" | "),
    );
  }

  lines.push(
    "",
    "Review these handles manually before editing `index/seeds/creators.json`.",
    "",
  );

  return `${lines.join("\n")}`;
}
