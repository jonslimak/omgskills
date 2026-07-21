import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "..");

function readJSON(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export function verifyMenubarLibraryInput({
  repoRoot = defaultRepoRoot,
  manifestPath = join(repoRoot, "site/data/v2/manifest.json"),
} = {}) {
  const skillsPath = join(repoRoot, "index/skills.json");
  if (!existsSync(skillsPath)) {
    throw new Error(`missing promoted library: ${skillsPath}`);
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`missing v2 manifest: ${manifestPath}`);
  }

  const manifest = readJSON(manifestPath, "v2 manifest");
  const asset = manifest.skills;
  if (!asset || typeof asset.path !== "string" || !asset.path) {
    throw new Error("v2 manifest is missing its skills asset");
  }

  const manifestDir = dirname(manifestPath);
  const assetPath = resolve(manifestDir, asset.path);
  const assetRelativePath = relative(manifestDir, assetPath);
  if (assetRelativePath.startsWith("..") || isAbsolute(assetRelativePath)) {
    throw new Error(`v2 skills asset escapes the manifest directory: ${asset.path}`);
  }
  if (!existsSync(assetPath)) {
    throw new Error(`missing v2 skills asset: ${assetPath}`);
  }

  const assetData = readFileSync(assetPath);
  if (assetData.length !== asset.bytes) {
    throw new Error(`v2 skills byte count mismatch: expected ${asset.bytes}, got ${assetData.length}`);
  }
  const assetHash = createHash("sha256").update(assetData).digest("hex");
  if (assetHash !== asset.sha256) {
    throw new Error(`v2 skills hash mismatch: expected ${asset.sha256}, got ${assetHash}`);
  }

  const promotedData = readFileSync(skillsPath);
  if (!promotedData.equals(assetData)) {
    throw new Error("index/skills.json is not byte-identical to the validated v2 skills asset");
  }

  const shadowDir = join(repoRoot, "index/shadow");
  const reportPath = join(shadowDir, "shadow-report.json");
  const cutoverPath = join(shadowDir, "skills.cutover.shadow.json");
  const hasReport = existsSync(reportPath);
  const hasCutover = existsSync(cutoverPath);

  if (hasReport !== hasCutover) {
    throw new Error("shadow validation is incomplete; both report and cutover files are required");
  }

  if (hasReport) {
    const report = readJSON(reportPath, "shadow report");
    if (!report.cutoverValidationPassed) {
      throw new Error("v2 build requires a passing shadow cutover validation");
    }

    const cutover = readJSON(cutoverPath, "shadow cutover");
    const promoted = cutover.filter((skill) => !(
      !skill.author_handle && ["catalog", "repackaged"].includes(skill.provenance_type)
    ));
    const current = readJSON(skillsPath, "promoted library");
    const promotedIDs = promoted.map((skill) => skill.id);
    const currentIDs = current.map((skill) => skill.id);
    if (JSON.stringify(promotedIDs) !== JSON.stringify(currentIDs)) {
      throw new Error("shadow cutover does not match the promoted v2 library");
    }
  }

  return {
    bytes: assetData.length,
    sha256: assetHash,
    shadowValidated: hasReport,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifestPath = process.env.OMGSKILLS_DATA_MANIFEST_PATH
      ? resolve(process.cwd(), process.env.OMGSKILLS_DATA_MANIFEST_PATH)
      : undefined;
    const result = verifyMenubarLibraryInput({ manifestPath });
    const shadowStatus = result.shadowValidated ? " plus matching shadow validation" : "";
    console.log(`✓ v2 release input verified (${result.bytes} bytes, ${result.sha256.slice(0, 12)})${shadowStatus}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
