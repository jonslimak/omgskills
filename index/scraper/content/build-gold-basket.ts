/**
 * Builds the gold basket: 50–200 essential skills across 10 niches.
 *
 * Scoring formula:
 *   score = (installs * 0.5) + (stars * 0.3) + (trending_rank_inverse * 0.2)
 *   +20% boost for externally validated skills (appear on 2+ curated lists)
 *
 * Output: index/gold-basket.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { TRUSTED_VENDOR_SET } from "./vendors.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(here, "..", "..", "skills.json");
const trendingPath = join(here, "..", "..", "trending.json");
const externalPath = join(here, "..", "..", "external-essentials.json");
const outPath = join(here, "..", "..", "gold-basket.json");

const TOP_PER_NICHE = 20;
const TOP_VALIDATED_OVERFLOW = 10; // extra slots per niche for validated skills
const MIN_STARS = 100;
const EXTERNAL_BOOST = 1.2;

// Maps tag keywords → canonical niche name.
// ORDER MATTERS: first match wins, so put more specific niches before broader ones.
const NICHE_TAG_MAP: Array<{ niche: string; label: string; tags: string[] }> = [
  {
    niche: "security",
    label: "Security",
    tags: [
      "fuzzing", "vulnerability", "cve", "exploit",
      "penetration-testing", "pentest", "cryptography", "sanitizer",
      "semgrep", "codeql", "sast", "smart-contract",
      "owasp", "threat-modeling", "supply-chain-security",
      "security-audit", "malware", "ctf", "cybersecurity",
    ],
  },
  {
    niche: "agent-workflow",
    label: "Agent Memory & Workflow",
    tags: [
      "agent-memory", "context-compression", "token-optimization",
      "self-improving", "meta-skill", "claude-md", "subagent",
      "worktree", "git-worktree", "parallel-agents", "issue-tracking",
      "prd", "task-management",
    ],
  },
  {
    niche: "media-creative",
    label: "Media & Creative",
    tags: [
      "image-generation", "generative-art", "stable-diffusion",
      "midjourney", "dall-e", "video", "audio", "music", "animation",
      "gif", "tts", "speech", "whisper", "remotion",
      "comic", "illustration", "3d", "creative-writing",
    ],
  },
  {
    niche: "coding-productivity",
    label: "Coding Productivity",
    tags: [
      "debugging", "code-review", "refactor", "code-quality", "testing",
      "linting", "code-generation", "developer-tools", "ai-coding",
      "code-analysis", "formatter", "lint", "unit-test", "tdd",
    ],
  },
  {
    niche: "devops",
    label: "DevOps & CI/CD",
    tags: [
      "devops", "ci-cd", "deploy", "deployment", "infrastructure",
      "docker", "kubernetes", "github-actions", "ci", "cd", "pipeline",
      "terraform", "ansible", "helm", "cloud", "aws", "gcp", "azure",
    ],
  },
  {
    niche: "writing-docs",
    label: "Writing & Documentation",
    tags: [
      "documentation", "docs", "readme", "changelog", "writing",
      "markdown", "technical-writing", "docstring", "comments", "wiki",
      "copywriting", "blog", "newsletter",
    ],
  },
  {
    niche: "design-ui",
    label: "Design & UI",
    tags: [
      "design", "ui", "css", "frontend", "react", "vue", "tailwind",
      "components", "figma", "html", "ux", "interface", "shadcn",
      "storybook", "accessibility", "responsive",
    ],
  },
  {
    niche: "data-analytics",
    label: "Data & Analytics",
    tags: [
      "data", "sql", "analytics", "database", "charting", "visualization",
      "pandas", "csv", "sqlite", "postgres", "mysql", "bigquery",
      "data-science", "machine-learning", "jupyter",
    ],
  },
  {
    niche: "automation",
    label: "Web Scraping & Automation",
    tags: [
      "automation", "workflow", "scraping", "crawler", "scheduler",
      "n8n", "zapier", "selenium", "playwright", "puppeteer", "cron",
      "web-scraping", "rpa", "integration",
    ],
  },
  {
    niche: "mcp",
    label: "MCP Servers",
    tags: [
      "mcp", "model-context-protocol", "mcp-server", "tool-use",
      "context-protocol",
    ],
  },
  {
    niche: "content-marketing",
    label: "Content & Marketing",
    tags: [
      "marketing", "content", "social-media", "email", "seo",
      "twitter", "linkedin", "ads", "growth", "branding",
    ],
  },
  {
    niche: "research",
    label: "Research & Summarization",
    tags: [
      "research", "summarize", "summarization", "analysis", "papers",
      "youtube", "web-search", "search", "rag", "knowledge-base",
      "reading", "citation",
    ],
  },
  {
    niche: "ai-orchestration",
    label: "AI Orchestration",
    tags: [
      "prompt-engineering", "multi-agent", "orchestration", "agent-orchestration",
      "llm", "chain-of-thought", "reasoning", "agent", "agentic",
    ],
  },
];

// Extra name/description phrases checked only for specific niches where tag matching
// is insufficient (e.g. trailofbits skills have empty tags but descriptive names).
const NICHE_NAME_PHRASES: Record<string, string[]> = {
  "security": [
    "fuzz", "vuln", "exploit", "pentest", "malware", "cve", "sanitizer",
    "owasp", "injection", "xss", "sqli", "audit trail", "security scan",
    "threat", "reentrancy", "smart contract", "solana", "cairo",
    "algorand", "cosmos", "token integration",
  ],
  "agent-workflow": [
    "worktree", "subagent", "sub-agent", "parallel agent", "claude.md",
    "agent skill", "self-improving", "token usage", "context window",
    "compress memory", "memory file",
  ],
  "media-creative": [
    "image gen", "generate image", "generate video", "text to speech",
    "tts", "speech to text", "transcribe", "remotion", "animation",
    "gif creator", "comic", "illustrat", "generative art",
  ],
};

function detectNiche(skill: Skill): string {
  const tagSet = new Set(skill.tags.map((t) => t.toLowerCase()));
  const descLower = skill.description.toLowerCase();
  const nameLower = skill.name.toLowerCase().replace(/-/g, " ");
  const combined = nameLower + " " + descLower;

  for (const { niche, tags } of NICHE_TAG_MAP) {
    // Tag and keyword match
    for (const keyword of tags) {
      const kw = keyword.replace(/-/g, " ");
      if (tagSet.has(keyword) || descLower.includes(kw) || nameLower.includes(kw)) {
        return niche;
      }
    }
    // Extra phrase match for niches that need it
    for (const phrase of NICHE_NAME_PHRASES[niche] ?? []) {
      if (combined.includes(phrase)) return niche;
    }
  }

  return "general";
}

// The general niche catches everything that doesn't fit elsewhere
const GENERAL_NICHE = { niche: "general", label: "General & Utilities", tags: [] as string[] };

interface TrendingEntry {
  id: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
}

interface ExternalEssential {
  repo: string;
  sources: string[];
  source_count: number;
}

export interface GoldSkill extends Skill {
  niche: string;
  niche_label: string;
  score: number;
  installs: number;
  trending_rank: number | null;
  externally_validated: boolean;
  external_source_count: number;
  official_vendor: boolean;
}

function computeScore(
  skill: Skill,
  installs: number,
  trendingRank: number | null,
  maxInstalls: number,
  maxStars: number,
  totalTrending: number,
  isExternal: boolean,
): number {
  const normalizedInstalls = maxInstalls > 0 ? installs / maxInstalls : 0;
  const normalizedStars = maxStars > 0 ? skill.stars / maxStars : 0;
  const rankInverse = trendingRank !== null ? (totalTrending - trendingRank + 1) / totalTrending : 0;

  let score = normalizedInstalls * 0.5 + normalizedStars * 0.3 + rankInverse * 0.2;

  if (isExternal) score *= EXTERNAL_BOOST;

  return Math.round(score * 1000) / 10;
}

function main() {
  const skills: Skill[] = JSON.parse(readFileSync(skillsPath, "utf8"));
  const trending: TrendingEntry[] = JSON.parse(readFileSync(trendingPath, "utf8"));

  let externalRepos = new Map<string, number>();
  if (existsSync(externalPath)) {
    const externals: ExternalEssential[] = JSON.parse(readFileSync(externalPath, "utf8"));
    for (const e of externals) externalRepos.set(e.repo, e.source_count);
    const validated = [...externalRepos.values()].filter((c) => c >= 2).length;
    console.log(`Loaded ${externalRepos.size} external repos (${validated} on 2+ lists)`);
  } else {
    console.log("No external-essentials.json found — run fetch-external-essentials first for better results");
  }

  const trendingMap = new Map<string, TrendingEntry>();
  for (const t of trending) trendingMap.set(t.id, t);

  const maxInstalls = Math.max(...trending.map((t) => t.installs), 1);
  const maxStars = Math.max(...skills.map((s) => s.stars), 1);
  const totalTrending = trending.length;

  console.log(`Loaded ${skills.length} skills, ${trending.length} trending entries`);
  console.log(`Max installs: ${maxInstalls}, max stars: ${maxStars}`);

  const scored: GoldSkill[] = [];
  let skipped = 0;

  for (const skill of skills) {
    const trendEntry = trendingMap.get(skill.id);
    const installs = trendEntry?.installs ?? 0;
    const trendingRank = trendEntry?.trending_rank ?? null;

    const repoId = skill.github_url.replace("https://github.com/", "");
    const listCount = externalRepos.get(repoId) ?? 0;
    const isVendor = TRUSTED_VENDOR_SET.has(skill.author_handle);
    const sourceCount = listCount + (isVendor ? 1 : 0);
    const isExternal = sourceCount >= 2;

    if (skill.stars < MIN_STARS) {
      skipped++;
      continue;
    }

    const score = computeScore(skill, installs, trendingRank, maxInstalls, maxStars, totalTrending, isExternal);
    const niche = detectNiche(skill);
    const nicheEntry = NICHE_TAG_MAP.find((n) => n.niche === niche) ?? GENERAL_NICHE;

    scored.push({
      ...skill,
      niche,
      niche_label: nicheEntry.label,
      score,
      installs,
      trending_rank: trendingRank,
      externally_validated: isExternal,
      external_source_count: sourceCount,
      official_vendor: isVendor,
    });
  }

  console.log(`Scored ${scored.length} skills (skipped ${skipped} below threshold)`);

  const byNiche = new Map<string, GoldSkill[]>();
  for (const skill of scored) {
    if (!byNiche.has(skill.niche)) byNiche.set(skill.niche, []);
    byNiche.get(skill.niche)!.push(skill);
  }

  const basket: GoldSkill[] = [];
  const basketIds = new Set<string>();

  for (const { niche, label } of [...NICHE_TAG_MAP, GENERAL_NICHE]) {
    const niched = (byNiche.get(niche) ?? []).sort((a, b) => b.score - a.score);

    // Primary: top 20 (any skill)
    const top = niched.slice(0, TOP_PER_NICHE);
    for (const s of top) {
      basket.push(s);
      basketIds.add(s.id);
    }

    // Validated overflow: up to 10 more, validated skills only
    let overflow = 0;
    for (const s of niched.slice(TOP_PER_NICHE)) {
      if (overflow >= TOP_VALIDATED_OVERFLOW) break;
      if (s.external_source_count >= 1 || s.official_vendor) {
        basket.push(s);
        basketIds.add(s.id);
        overflow++;
      }
    }

    console.log(`  ${label}: ${top.length} primary + ${overflow} validated overflow (${niched.length} total)`);
  }

  basket.sort((a, b) => b.score - a.score);

  writeFileSync(outPath, JSON.stringify(basket, null, 2) + "\n");

  console.log(`\nGold basket: ${basket.length} skills across ${byNiche.size} niches`);
  console.log(`Externally validated: ${basket.filter((s) => s.externally_validated).length}`);
  console.log(`→ ${outPath}`);
}

main();
