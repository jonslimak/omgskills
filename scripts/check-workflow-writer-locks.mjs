import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WRITER_LOCK = "app-data-writers";
const SYNC_STEP_NAME = "Sync latest main";

function hasGitPush(source) {
  return source.split("\n").some((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("#") && /\bgit\s+push(?:\s|$)/.test(trimmed);
  });
}

function hasProductionDeploy(source) {
  return /\bnpm\s+run\s+deploy:production\b/.test(source) ||
    /\bnetlify-cli\s+deploy\b/.test(source);
}

function syncStep(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*-\\s+name:\\s*["']?${SYNC_STEP_NAME}["']?\\s*$`).test(line),
  );

  if (start === -1) return "";

  const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*-\s+name:/.test(lines[index])) {
      const nextIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
      if (nextIndent === indent) {
        end = index;
        break;
      }
    }
  }

  return lines.slice(start, end).join("\n");
}

export function validateWorkflowWriterSafety(source, filename = "workflow") {
  const pushes = hasGitPush(source);
  const deploys = hasProductionDeploy(source);
  if (!pushes && !deploys) return [];

  const errors = [];
  const publishesRootData = /^\s*run:\s+\.\/scripts\/publish-data\.sh\s*$/m.test(source);
  const hasSharedLock = new RegExp(
    `^\\s*group:\\s*["']?${WRITER_LOCK}["']?\\s*(?:#.*)?$`,
    "m",
  ).test(source);
  if (!hasSharedLock) {
    errors.push(`${filename}: production writes require concurrency group ${WRITER_LOCK}`);
  }

  const step = syncStep(source);
  if (!step) {
    errors.push(`${filename}: production writes require a ${SYNC_STEP_NAME} step`);
    return errors;
  }
  if (!/\bgit\s+fetch\s+origin\s+main\b/.test(step)) {
    errors.push(`${filename}: ${SYNC_STEP_NAME} must fetch origin main`);
  }
  if (!/\bgit\s+reset\s+--hard\s+origin\/main\b/.test(step)) {
    errors.push(`${filename}: ${SYNC_STEP_NAME} must reset to origin/main`);
  }
  if (publishesRootData && !/\bgit\s+add\s+-A\s+--\s+site\/data\b/.test(source)) {
    errors.push(`${filename}: root data publishers must stage the complete site/data directory`);
  }
  if (deploys) {
    if (/\bnetlify-cli\s+deploy\b/.test(source)) {
      errors.push(`${filename}: production deploys must use npm run deploy:production`);
    }
    if (!/\bnpm\s+run\s+deploy:production\b/.test(source)) {
      errors.push(`${filename}: production deploy is missing the shared deploy helper`);
    }
    if (!/^\s*issues:\s*write\s*$/m.test(source)) {
      errors.push(`${filename}: production deploy requires issues: write`);
    }
    if (!/name:\s*Upload production deploy receipt[\s\S]*?if:\s*always\(\)[^\n]*production_deploy\.outcome\s*!=\s*'skipped'[\s\S]*?dist\/netlify-deploy-receipt\.json/.test(source)) {
      errors.push(`${filename}: production deploy must always upload its receipt`);
    }
    const deployIndex = source.indexOf("npm run deploy:production");
    const buildIndex = source.lastIndexOf("npm run build:netlify", deployIndex);
    const pushIndex = source.lastIndexOf("git push", deployIndex);
    if (buildIndex === -1 || buildIndex > deployIndex) {
      errors.push(`${filename}: shared deploy helper must run after the production build`);
    }
    if (pushes && (pushIndex === -1 || pushIndex > deployIndex)) {
      errors.push(`${filename}: shared deploy helper must run after the workflow's git push`);
    }
  }

  return errors;
}

export async function checkWorkflowDirectory(workflowDirectory) {
  const filenames = (await readdir(workflowDirectory))
    .filter((filename) => /\.ya?ml$/i.test(filename))
    .sort();
  const errors = [];

  for (const filename of filenames) {
    const source = await readFile(path.join(workflowDirectory, filename), "utf8");
    errors.push(...validateWorkflowWriterSafety(source, filename));
  }

  return { errors, workflowCount: filenames.length };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workflowDirectory = path.join(repoRoot, ".github", "workflows");
  const { errors, workflowCount } = await checkWorkflowDirectory(workflowDirectory);

  if (errors.length > 0) {
    console.error("Workflow writer safety check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Workflow writer safety OK (${workflowCount} workflows checked)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
