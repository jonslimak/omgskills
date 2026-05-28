import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Skill } from "../types.js";
import type { ShadowRunReport, ShadowSkillRecord } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultIndexRoot = join(here, "..", "..");
const defaultShadowRoot = join(defaultIndexRoot, "shadow");
const MIN_PROMOTION_RATIO = 0.8;

type PromoteCutoverOptions = {
  indexRoot?: string;
  shadowRoot?: string;
};

type PromotionFailure = Error & { code?: string };

export type PromotionSummary = {
  cutoverSkillCount: number;
  promotedSkillCount: number;
  filteredTotal: number;
  filteredCatalogCount: number;
  filteredRepackagedCount: number;
};

function fail(message: string, code: string): never {
  const error = new Error(message) as PromotionFailure;
  error.code = code;
  throw error;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function stringifySkills(skills: Skill[]) {
  return JSON.stringify(skills, null, 2) + "\n";
}

function hasDuplicateIds(skills: Skill[]): string | null {
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.id)) return skill.id;
    seen.add(skill.id);
  }
  return null;
}

export function isPromotionFilteredSkill(skill: ShadowSkillRecord): boolean {
  return !skill.author_handle && (skill.provenance_type === "catalog" || skill.provenance_type === "repackaged");
}

export function buildPromotedSkills(
  cutoverSkills: ShadowSkillRecord[],
  currentSkills: Skill[],
): { promotedSkills: Skill[]; summary: PromotionSummary } {
  const filteredCatalogCount = cutoverSkills.filter(
    (skill) => !skill.author_handle && skill.provenance_type === "catalog",
  ).length;
  const filteredRepackagedCount = cutoverSkills.filter(
    (skill) => !skill.author_handle && skill.provenance_type === "repackaged",
  ).length;
  const promotedSkills = cutoverSkills.filter((skill) => !isPromotionFilteredSkill(skill));
  const duplicateId = hasDuplicateIds(promotedSkills);
  if (duplicateId) {
    fail(`duplicate promoted skill id: ${duplicateId}`, "DUPLICATE_PROMOTED_SKILL_ID");
  }

  const cutoverSkillCount = cutoverSkills.length;
  const promotedSkillCount = promotedSkills.length;
  const currentSkillCount = currentSkills.length;

  if (cutoverSkillCount > 0 && promotedSkillCount < cutoverSkillCount * MIN_PROMOTION_RATIO) {
    fail(
      `promoted skill count ${promotedSkillCount} is below ${Math.round(MIN_PROMOTION_RATIO * 100)}% of cutover count ${cutoverSkillCount}`,
      "PROMOTED_TOO_SMALL_VS_CUTOVER",
    );
  }
  if (currentSkillCount > 0 && promotedSkillCount < currentSkillCount * MIN_PROMOTION_RATIO) {
    fail(
      `promoted skill count ${promotedSkillCount} is below ${Math.round(MIN_PROMOTION_RATIO * 100)}% of current production count ${currentSkillCount}`,
      "PROMOTED_TOO_SMALL_VS_CURRENT",
    );
  }

  return {
    promotedSkills,
    summary: {
      cutoverSkillCount,
      promotedSkillCount,
      filteredTotal: filteredCatalogCount + filteredRepackagedCount,
      filteredCatalogCount,
      filteredRepackagedCount,
    },
  };
}

export function promoteCutover(options: PromoteCutoverOptions = {}): PromotionSummary {
  const indexRoot = options.indexRoot ?? defaultIndexRoot;
  const shadowRoot = options.shadowRoot ?? defaultShadowRoot;
  const cutoverSkillsPath = join(shadowRoot, "skills.cutover.shadow.json");
  const shadowReportPath = join(shadowRoot, "shadow-report.json");
  const productionSkillsPath = join(indexRoot, "skills.json");

  if (!existsSync(cutoverSkillsPath)) {
    fail(`missing cutover skills file: ${cutoverSkillsPath}`, "MISSING_CUTOVER_SKILLS");
  }
  if (!existsSync(shadowReportPath)) {
    fail(`missing shadow report file: ${shadowReportPath}`, "MISSING_SHADOW_REPORT");
  }
  if (!existsSync(productionSkillsPath)) {
    fail(`missing production skills file: ${productionSkillsPath}`, "MISSING_PRODUCTION_SKILLS");
  }

  const shadowReport = readJson<ShadowRunReport>(shadowReportPath);
  if (!shadowReport.cutoverValidationPassed) {
    fail("cutover validation did not pass", "CUTOVER_VALIDATION_FAILED");
  }

  const cutoverSkills = readJson<ShadowSkillRecord[]>(cutoverSkillsPath);
  const currentSkills = readJson<Skill[]>(productionSkillsPath);
  const { promotedSkills, summary } = buildPromotedSkills(cutoverSkills, currentSkills);

  writeAtomic(productionSkillsPath, stringifySkills(promotedSkills));

  return summary;
}

async function main() {
  const summary = promoteCutover();
  console.log(`promote-cutover: cutover skills ${summary.cutoverSkillCount}`);
  console.log(`promote-cutover: promoted skills ${summary.promotedSkillCount}`);
  console.log(`promote-cutover: filtered total ${summary.filteredTotal}`);
  console.log(`promote-cutover: filtered catalog ${summary.filteredCatalogCount}`);
  console.log(`promote-cutover: filtered repackaged ${summary.filteredRepackagedCount}`);
  console.log(`promote-cutover: wrote -> ${join(defaultIndexRoot, "skills.json")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
