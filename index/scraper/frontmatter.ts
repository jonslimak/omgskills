import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  name?: string;
  description?: string;
  tags?: string[];
}

// Agents read SKILL.md frontmatter loosely, so a file they load should not be rejected here
// for a byte-order mark, Windows line endings, or YAML that is strict-invalid (unquoted colons,
// stray quotes, an unclosed block). Strict YAML is tried first; if it fails, only the top-level
// `name:` and `description:` lines are read. A file without a frontmatter block still fails.
export function parseFrontmatter(content: string): Frontmatter | null {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/^\s*\n/, "");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end).trim();
  try {
    const parsed = parseYaml(block);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return clean(parsed as Record<string, unknown>);
  } catch {
    // fall through to the line reader
  }
  return readTopLevelLines(block);
}

/** The text after the frontmatter block, or the whole file when it has none. */
export function stripFrontmatter(content: string): string {
  const text = content.replace(/^﻿/, "");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4);
}

function clean(fields: Record<string, unknown>): Frontmatter {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  return {
    name: text(fields.name),
    description: text(fields.description),
    ...(fields.tags !== undefined ? { tags: fields.tags as string[] } : {}),
  };
}

function readTopLevelLines(block: string): Frontmatter | null {
  const lines = block.split("\n");
  const found: Frontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^(name|description):(?:\s+(.*))?$/.exec(lines[i]!);
    if (!match || found[match[1] as "name" | "description"] !== undefined) continue;
    let value = (match[2] ?? "").trim();
    const continuation: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) continuation.push(lines[++i]!.trim());
    if (/^[|>][-+0-9]*$/.test(value)) value = continuation.join(value.startsWith("|") ? "\n" : " ");
    else if (continuation.length) value = [value, ...continuation].join(" ");
    value = unquote(value).trim();
    if (value) found[match[1] as "name" | "description"] = value;
  }
  return found.name || found.description ? found : null;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"');
  return value;
}
