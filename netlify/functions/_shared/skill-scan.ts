// Safety scan for files saved to the cloud. Secrets hold a file back until the
// user confirms it; everything else only labels the skill. Findings never carry
// the matched text, only what was found and where.

export type SkillLabel =
  | "scripts"
  | "download_and_run"
  | "invisible_characters"
  | "hidden_instructions"
  | "confirmed_secret";

export type SecretFinding = { rule: string; kind: string; line: number };

export type FileScan = {
  secrets: SecretFinding[];
  labels: SkillLabel[];
};

type SecretRule = { rule: string; kind: string; pattern: RegExp; check?: (match: RegExpExecArray) => boolean };

const placeholder = /^(?:x+|\*+|\.+|0+|1234\w*|changeme|example\w*|placeholder|pass(?:word)?|secret|redacted|dummy|test\w*|your[_-]?\w*|<[^>]*>|\$\{?\w+\}?|%\w+%|\{\{[^}]*\}\})$/i;

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / value.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

/**
 * A value assigned to a key or password field that looks like the real thing:
 * letters and digits mixed, and not code that reads one (a call, an attribute
 * chain such as process.env.API_KEY, or a template placeholder).
 */
function looksGenerated(value: string): boolean {
  return !placeholder.test(value)
    && !/(?:\.\.\.|\u2026)$/.test(value)
    && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
    && !/[()[\]{}<>]/.test(value)
    && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+!?$/.test(value);
}

const SECRET_RULES: SecretRule[] = [
  { rule: "private_key", kind: "Private key", pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: "aws_access_key", kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { rule: "github_token", kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { rule: "anthropic_key", kind: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{30,}/g },
  { rule: "openai_key", kind: "OpenAI API key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
    check: (match) => !match[0].startsWith("sk-ant-") },
  { rule: "stripe_key", kind: "Stripe secret key", pattern: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/g },
  { rule: "slack_token", kind: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { rule: "google_api_key", kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { rule: "npm_token", kind: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { rule: "jwt", kind: "Signed token (JWT)", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g },
  {
    rule: "credential_in_url",
    kind: "Password in a URL",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s:/@]{6,})@/gi,
    check: (match) => !placeholder.test(match[1]) && !/[${}<>]/.test(match[1])
  },
  {
    rule: "assigned_secret",
    kind: "Key or password",
    pattern: /(?<![A-Za-z])(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?([A-Za-z0-9/+_.~-]{16,})/gi,
    check: (match) => looksGenerated(match[1]) && entropy(match[1]) >= 3.5
  },
  {
    rule: "assigned_password",
    kind: "Password",
    pattern: /(?<![A-Za-z])(?:password|passwd|pwd)\b["']?\s*[:=]\s*["']?([^\s"'`,;]{8,})/gi,
    // A real password mixes letters with digits or symbols; plain words are prose or field names.
    check: (match) => looksGenerated(match[1]) && entropy(match[1]) >= 3
  }
];

const DOWNLOAD_AND_RUN = [
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i,
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:python[0-9.]*|node|perl|ruby)\b/i,
  /\b(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)\b/i,
  /\b(?:iex|Invoke-Expression)\b[^\n]*(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString)\b/i,
  /\bpowershell(?:\.exe)?\b[^\n]*\s-(?:e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i
];

// Zero-width characters, bidirectional controls and Unicode tag characters can hide text from readers.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u{E0000}-\u{E007F}]|(?<!^)\uFEFF/u;

const INJECTION = [
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts?|rules)\b/i,
  /\b(?:do\s+not|don't|never)\s+(?:tell|inform|mention\s+(?:this\s+)?to|alert|show)\s+the\s+user\b/i,
  /\bwithout\s+(?:telling|informing|asking)\s+the\s+user\b/i,
  /\b(?:exfiltrate|send\s+(?:the\s+)?(?:contents?\s+of\s+)?(?:~\/\.ssh|\.env|credentials|api\s+keys?)\b)/i
];

const SCRIPT_EXTENSIONS = /\.(?:sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php|ps1|psm1|bat|cmd|applescript|scpt|lua|go|rs|swift|jar)$/i;

function isBinary(data: Uint8Array): boolean {
  return data.subarray(0, 8192).includes(0);
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let position = text.indexOf("\n"); position !== -1 && position < index; position = text.indexOf("\n", position + 1)) {
    line += 1;
  }
  return line;
}

/** Scans one file's contents. Labels that depend on the file's path or mode come from pathLabels. */
export function scanFileContents(data: Uint8Array): FileScan {
  if (isBinary(data)) return { secrets: [], labels: [] };
  const text = Buffer.from(data).toString("utf8");
  const secrets: SecretFinding[] = [];
  const seen = new Set<string>();
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(text); match; match = rule.pattern.exec(text)) {
      if (rule.check && !rule.check(match)) continue;
      const line = lineAt(text, match.index);
      const key = `${rule.rule}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      secrets.push({ rule: rule.rule, kind: rule.kind, line });
    }
  }
  const labels: SkillLabel[] = [];
  if (DOWNLOAD_AND_RUN.some((pattern) => pattern.test(text))) labels.push("download_and_run");
  if (INVISIBLE.test(text)) labels.push("invisible_characters");
  if (INJECTION.some((pattern) => pattern.test(text))) labels.push("hidden_instructions");
  secrets.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
  return { secrets, labels };
}

export function pathLabels(path: string, mode: string): SkillLabel[] {
  return mode === "100755" || SCRIPT_EXTENSIONS.test(path) ? ["scripts"] : [];
}

const LABEL_ORDER: SkillLabel[] = ["confirmed_secret", "download_and_run", "hidden_instructions", "invisible_characters", "scripts"];

export function combineLabels(lists: Iterable<readonly string[]>): SkillLabel[] {
  const all = new Set<string>();
  for (const list of lists) for (const label of list) all.add(label);
  return LABEL_ORDER.filter((label) => all.has(label));
}
