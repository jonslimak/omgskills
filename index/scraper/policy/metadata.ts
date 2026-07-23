import { execFileSync } from "node:child_process";
import type { PolicySources } from "./types.js";
import { effectivePolicyDigest } from "./digest.js";

export type PolicyRunMetadata = {
  sourceCommit: string;
  policyDigest: string;
};

export function currentSourceCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA?.trim() || "unknown";
  }
}

export function policyRunMetadata(sources: PolicySources): PolicyRunMetadata {
  return {
    sourceCommit: currentSourceCommit(),
    policyDigest: effectivePolicyDigest(sources),
  };
}
