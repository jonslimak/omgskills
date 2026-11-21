import { omgRules } from "./omg-rules.js";
import type { Scanner } from "./types.js";

/** Every scanner the container runs, in order. */
export function scanners(versions: { omgRules: string }): Scanner[] {
  return [omgRules(versions.omgRules)];
}
