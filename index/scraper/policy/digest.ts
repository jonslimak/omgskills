import { createHash } from "node:crypto";
import type { PolicySources } from "./types.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function effectivePolicyDigest(sources: PolicySources): string {
  const canonical = JSON.stringify(stableValue(sources));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
