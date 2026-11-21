import { isBinary, labelLines, pathLabels, scanFileContents } from "../../../../netlify/functions/_shared/skill-scan.js";
import type { Finding, Severity } from "../../../src/protocol.js";
import type { Scanner } from "./types.js";

const SEVERITY: Record<string, Severity> = {
  secret: "high",
  download_and_run: "high",
  hidden_instructions: "high",
  invisible_characters: "medium",
  scripts: "info"
};

// Files that are text by their name. A stray zero byte in one doesn't hide it from the scan.
const TEXT_FILE = /(?:^|\/)(?:SKILL\.md|[^/]*\.(?:md|markdown|txt|rst|json|jsonc|ya?ml|toml|ini|cfg|conf|env|xml|html?|css|csv|tsv|sql|sh|bash|zsh|fish|py|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|ps1|psm1|bat|cmd|applescript|lua|go|rs|swift|java|kt|c|h|cpp|hpp|cs))$/i;

/** Our own rules, the same ones that run when a skill is saved. */
export function omgRules(version: string): Scanner {
  return {
    name: "omg-rules",
    version,
    async scan(files) {
      const findings: Finding[] = [];
      let filesSkipped = 0;
      for (const file of files) {
        for (const label of pathLabels(file.path, file.mode)) {
          findings.push({ rule: label, label, severity: SEVERITY[label], path: file.path, line: null });
        }
        const text = TEXT_FILE.test(file.path) || file.mode === "100755";
        if (!text && isBinary(file.data)) {
          filesSkipped += 1;
          continue;
        }
        for (const secret of scanFileContents(file.data, { text: true }).secrets) {
          findings.push({ rule: secret.rule, label: "secret", severity: SEVERITY.secret, path: file.path, line: secret.line });
        }
        for (const found of labelLines(file.data, { text: true })) {
          findings.push({ rule: found.label, label: found.label, severity: SEVERITY[found.label], path: file.path, line: found.line });
        }
      }
      // Binary files (images and such) have no text for these rules; skipping them leaves the scan complete.
      return { status: "complete", findings, filesScanned: files.length - filesSkipped, filesSkipped };
    }
  };
}
