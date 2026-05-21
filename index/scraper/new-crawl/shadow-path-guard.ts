import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const indexRoot = normalize(join(here, "..", ".."));
export const shadowRoot = normalize(join(indexRoot, "shadow"));
export const protectedProductionPaths = new Set([
  normalize(join(indexRoot, "skills.json")),
  normalize(join(indexRoot, "skill-signals.json")),
  normalize(join(indexRoot, "..", "site", "data", "manifest.json")),
]);

export function isShadowPathAllowed(path: string): boolean {
  const normalized = normalize(path);
  if (protectedProductionPaths.has(normalized)) return false;
  return normalized.startsWith(shadowRoot + "/") || normalized === shadowRoot;
}

export function assertShadowPath(path: string): void {
  const normalized = normalize(path);
  if (protectedProductionPaths.has(normalized)) {
    throw new Error(`Shadow write blocked for production path: ${normalized}`);
  }
  if (!isShadowPathAllowed(normalized)) {
    throw new Error(`Shadow write blocked outside index/shadow: ${normalized}`);
  }
}
