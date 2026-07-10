#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShadowSkillRecord } from "./types.js";
import { renderSecurityAuditMarkdown, runSecurityAudit } from "./security-audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexRoot = join(here, "..", "..");
const defaultSkillsPath = join(indexRoot, "shadow", "skills.cutover.shadow.json");

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "omgskills-security-audit" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const limit = numberArg("limit", 100);
  const offset = numberArg("offset", 0);
  const concurrency = numberArg("concurrency", 2);
  const requestDelayMs = numberArg("request-delay-ms", 250);
  const skillsPath = process.argv.find((arg) => arg.startsWith("--skills="))?.slice("--skills=".length) ?? defaultSkillsPath;
  const skills = JSON.parse(readFileSync(skillsPath, "utf8")) as ShadowSkillRecord[];

  const report = await runSecurityAudit(skills, {
    limit,
    offset,
    concurrency,
    requestDelayMs,
    fetchText,
  });

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderSecurityAuditMarkdown(report));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
