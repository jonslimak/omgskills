import type { ShadowSkillRecord } from "./types.js";

export type SecurityFindingCategory =
  | "prompt-override"
  | "prompt-disclosure"
  | "secret-exfiltration"
  | "remote-shell-execution"
  | "encoded-payload-execution"
  | "destructive-command";

export type SecurityFinding = {
  skillId: string;
  tier: "curated" | "creator";
  category: SecurityFindingCategory;
  evidence: string;
  githubUrl: string;
  skillPath: string;
  sourceUrl: string;
  status: "review";
};

export type SecurityAuditFailure = {
  skillId: string;
  tier: "curated" | "creator";
  reason: string;
};

export type SecurityAuditReport = {
  targetSkillCount: number;
  fetchableSkillCount: number;
  unscannableCount: number;
  unscannableSample: SecurityAuditFailure[];
  offset: number;
  limit: number;
  selectedCount: number;
  scannedCount: number;
  failedCount: number;
  findingCount: number;
  findings: SecurityFinding[];
  failures: SecurityAuditFailure[];
};

type TieredAuditSkill = ShadowSkillRecord & { quality_tier: "curated" | "creator" };

type AuditOptions = {
  limit: number;
  offset: number;
  concurrency?: number;
  requestDelayMs?: number;
  fetchText: (url: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
};

type PatternRule = {
  category: Exclude<SecurityFindingCategory, "secret-exfiltration">;
  pattern: RegExp;
};

type FetchResult =
  | { skill: TieredAuditSkill; sourceUrl: string; content: string; error?: never }
  | { skill: TieredAuditSkill; sourceUrl: string; error: string; content?: never };

const PATTERN_RULES: PatternRule[] = [
  {
    category: "prompt-override",
    pattern: /\b(?:ignore|disregard|override|bypass)\b[^\n]{0,100}\b(?:previous|prior|system|developer|security|safety)\b[^\n]{0,50}\b(?:instruction|prompt|rule)s?\b/i,
  },
  {
    category: "prompt-disclosure",
    pattern: /\b(?:reveal|print|display|dump|expose|return)\b[^\n]{0,80}\b(?:system|developer)\b[^\n]{0,30}\b(?:prompt|message|instruction)s?\b/i,
  },
  {
    category: "remote-shell-execution",
    pattern: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
  },
  {
    category: "encoded-payload-execution",
    pattern: /\b(?:base64\s+(?:-d|--decode)|openssl\s+base64\s+-d)\b[^\n|;]{0,200}(?:\||;|&&)\s*(?:sh|bash|zsh|python|node)\b/i,
  },
  {
    category: "destructive-command",
    pattern: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(?:--\s+)?(?:\/(?:\s|$)|~(?:\/|\s|$)|\$HOME(?:\/|\s|$))/i,
  },
];

const SECRET_SOURCE_PATTERN = /(?:\.env\b|id_rsa\b|\.aws\/credentials\b|\.ssh\/|\/proc\/self\/environ\b)/i;
const OUTBOUND_PATTERN = /(?:\b(?:curl|wget)\b[^\n]{0,160}\bhttps?:\/\/|\b(?:send|post|upload|transmit|exfiltrat\w*)\b[^\n]{0,120}\b(?:to|https?:\/\/|webhook)\b|\b(?:nc|netcat)\s+\S+\s+\d+)/i;
const DEFENSIVE_CONTEXT_PATTERN = /(?:\b(?:bad|unsafe|vulnerab\w*|attack|detect\w*|block\w*|prevent\w*|avoid|risk|sanitiz\w*|pattern)\b|\b(?:command|prompt|shell)\s+injection\b)/i;

function normalizeEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237).trimEnd()}...`;
}

function rawContextAround(content: string, index: number, matchLength: number, radius = 180): string {
  return content.slice(Math.max(0, index - radius), Math.min(content.length, index + matchLength + radius));
}

export function scanSkillContent(content: string): Array<{ category: SecurityFindingCategory; evidence: string }> {
  const findings: Array<{ category: SecurityFindingCategory; evidence: string }> = [];

  for (const rule of PATTERN_RULES) {
    const match = rule.pattern.exec(content);
    if (!match || match.index === undefined) continue;
    const context = rawContextAround(content, match.index, match[0].length);
    if (DEFENSIVE_CONTEXT_PATTERN.test(context)) continue;
    findings.push({
      category: rule.category,
      evidence: normalizeEvidence(context),
    });
  }

  for (const secretMatch of content.matchAll(new RegExp(SECRET_SOURCE_PATTERN.source, "gi"))) {
    if (secretMatch.index === undefined) continue;
    const context = rawContextAround(content, secretMatch.index, secretMatch[0].length, 260);
    if (!OUTBOUND_PATTERN.test(context) || DEFENSIVE_CONTEXT_PATTERN.test(context)) continue;
    findings.push({
      category: "secret-exfiltration",
      evidence: normalizeEvidence(context),
    });
    break;
  }

  return findings.sort((a, b) => a.category.localeCompare(b.category) || a.evidence.localeCompare(b.evidence));
}

export function selectSecurityAuditSkills(
  skills: ShadowSkillRecord[],
  offset: number,
  limit: number,
): {
  targetSkillCount: number;
  fetchableSkillCount: number;
  unscannable: SecurityAuditFailure[];
  selected: TieredAuditSkill[];
} {
  const target = skills
    .filter((skill): skill is TieredAuditSkill => skill.quality_tier === "curated" || skill.quality_tier === "creator")
    .sort((a, b) => {
      const tierOrder = (a.quality_tier === "curated" ? 0 : 1) - (b.quality_tier === "curated" ? 0 : 1);
      return tierOrder || a.id.localeCompare(b.id);
    });

  const fetchable: TieredAuditSkill[] = [];
  const unscannable: SecurityAuditFailure[] = [];
  for (const skill of target) {
    if (rawSkillUrl(skill)) {
      fetchable.push(skill);
    } else {
      unscannable.push({
        skillId: skill.id,
        tier: skill.quality_tier,
        reason: "missing concrete GitHub SKILL.md path",
      });
    }
  }

  return {
    targetSkillCount: target.length,
    fetchableSkillCount: fetchable.length,
    unscannable,
    selected: fetchable.slice(offset, offset + limit),
  };
}

export function rawSkillUrl(skill: Pick<ShadowSkillRecord, "github_url" | "skill_md_path">): string | null {
  const path = skill.skill_md_path?.trim();
  if (!path || path === "__RESOLVE__") return null;

  try {
    const url = new URL(skill.github_url);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !rawRepo) return null;
    const repo = rawRepo.replace(/\.git$/i, "");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${encodedPath}`;
  } catch {
    return null;
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSecurityAudit(skills: ShadowSkillRecord[], options: AuditOptions): Promise<SecurityAuditReport> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
  const requestDelayMs = Math.max(0, Math.floor(options.requestDelayMs ?? 250));
  const sleep = options.sleep ?? defaultSleep;
  const { targetSkillCount, fetchableSkillCount, unscannable, selected } = selectSecurityAuditSkills(
    skills,
    options.offset,
    options.limit,
  );
  const findings: SecurityFinding[] = [];
  const failures: SecurityAuditFailure[] = [];
  let scannedCount = 0;

  for (let index = 0; index < selected.length; index += concurrency) {
    const batch = selected.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (skill): Promise<FetchResult> => {
      const sourceUrl = rawSkillUrl(skill);
      if (!sourceUrl) {
        return { skill, sourceUrl: "", error: "missing concrete GitHub SKILL.md path" } as const;
      }
      try {
        const content = await options.fetchText(sourceUrl);
        return { skill, sourceUrl, content } as const;
      } catch (error) {
        return {
          skill,
          sourceUrl,
          error: error instanceof Error ? error.message : String(error),
        } as const;
      }
    }));

    for (const result of results) {
      if (result.error !== undefined) {
        failures.push({
          skillId: result.skill.id,
          tier: result.skill.quality_tier,
          reason: result.error,
        });
        continue;
      }
      scannedCount += 1;
      for (const finding of scanSkillContent(result.content)) {
        findings.push({
          skillId: result.skill.id,
          tier: result.skill.quality_tier,
          category: finding.category,
          evidence: finding.evidence,
          githubUrl: result.skill.github_url,
          skillPath: result.skill.skill_md_path ?? "",
          sourceUrl: result.sourceUrl,
          status: "review",
        });
      }
    }

    if (index + concurrency < selected.length && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  findings.sort((a, b) => a.skillId.localeCompare(b.skillId) || a.category.localeCompare(b.category));
  failures.sort((a, b) => a.skillId.localeCompare(b.skillId));

  return {
    targetSkillCount,
    fetchableSkillCount,
    unscannableCount: unscannable.length,
    unscannableSample: unscannable.slice(0, 20),
    offset: options.offset,
    limit: options.limit,
    selectedCount: selected.length,
    scannedCount,
    failedCount: failures.length,
    findingCount: findings.length,
    findings,
    failures,
  };
}

export function renderSecurityAuditMarkdown(report: SecurityAuditReport): string {
  const lines = [
    "# Crawl 4 Security Screening Audit",
    "",
    "> Review-only static screening. Findings are not proof of malicious behavior and do not change crawler output.",
    "",
    `- Target tier skills: ${report.targetSkillCount}`,
    `- Fetchable skills: ${report.fetchableSkillCount}`,
    `- Missing concrete paths: ${report.unscannableCount}`,
    `- Selected: ${report.selectedCount} (offset ${report.offset}, limit ${report.limit})`,
    `- Scanned: ${report.scannedCount}`,
    `- Failed: ${report.failedCount}`,
    `- Findings: ${report.findingCount}`,
    "",
    "## Findings",
    "",
  ];

  if (report.findings.length === 0) {
    lines.push("None.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- **${finding.category}** — \`${finding.skillId}\` (${finding.tier})`);
      lines.push(`  - ${finding.evidence}`);
      lines.push(`  - ${finding.sourceUrl}`);
    }
  }

  lines.push("", "## Fetch Failures", "");
  if (report.failures.length === 0) {
    lines.push("None.");
  } else {
    for (const failure of report.failures) {
      lines.push(`- \`${failure.skillId}\` (${failure.tier}): ${failure.reason}`);
    }
  }

  lines.push("", "## Missing Path Sample", "");
  if (report.unscannableSample.length === 0) {
    lines.push("None.");
  } else {
    for (const failure of report.unscannableSample) {
      lines.push(`- \`${failure.skillId}\` (${failure.tier}): ${failure.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
