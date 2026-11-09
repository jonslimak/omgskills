import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";

export type TrendingAttributionResult = {
  status: "clear" | "advisory" | "copy";
  reason: string;
  upstreamRepo?: string;
  upstreamPath?: string;
  upstreamCommit?: string;
  match?: "identical-content" | "name-only-change";
};

export type TrendingAttributionDependencies = {
  canonicalRepo: (repo: string) => Promise<string>;
  upstreamSkill: (repo: string, names: string[]) => Promise<{
    content: string; path: string; commit: string;
  } | null>;
};

const normalizeName = (value: string) => value.toLowerCase().replace(/[_\s]+/g, "-");

function installRepos(markdown: string, names: string[], allowPreamble: boolean): string[] {
  const wanted = new Set(names.map(normalizeName));
  const sections: Array<{ level: number; install: boolean }> = [];
  const repos = new Set<string>();
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const boundary = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (boundary) {
      if (!fence) fence = boundary[1]![0]!;
      else if (boundary[1]![0] === fence) fence = null;
      continue;
    }
    const heading = !fence && /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      while (sections.length && sections.at(-1)!.level >= heading[1]!.length) sections.pop();
      const title = heading[2]!.toLowerCase();
      const excluded = /related|see also|dependenc|prerequisite|requirements?|examples?|usage/.test(title);
      const install = !excluded && (/^install(?:ation| this skill| as skills| options)?$/.test(title)
        || sections.at(-1)?.install === true);
      sections.push({ level: heading[1]!.length, install });
      continue;
    }
    if (!sections.at(-1)?.install && !(allowPreamble && sections.length === 0)) continue;
    // Read a command, never execute it. Ignore prose, package installs, and related-skill examples.
    const command = /^\s*npx(?:\s+-y)?\s+skills(?:@[\w.-]+)?\s+add\s+["']?(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)(?:@([A-Za-z0-9_.-]+))?["']?(?=\s|$)(.*)$/.exec(line);
    if (!command) continue;
    const selector = /(?:^|\s)(?:--skill|-s)(?:=|\s+)["']?([A-Za-z0-9_.-]+)/.exec(command[3]!);
    const selectedName = command[2] ?? selector?.[1];
    if (selectedName && !wanted.has(normalizeName(selectedName))) continue;
    repos.add(command[1]!.replace(/\.git$/i, "").toLowerCase());
  }
  return [...repos].sort();
}

export function findTrendingSelfInstallRepos(skillContent: string, readme: string | null, names: string[]): string[] {
  const own = installRepos(skillContent, names, true);
  return own.length ? own : installRepos(readme ?? "", names, false);
}

function splitFrontmatter(content: string): { fields: Record<string, unknown>; body: string } | null {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimStart();
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text);
  if (!match) return null;
  try {
    const parsed: unknown = parseYaml(match[1]!);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { fields: parsed as Record<string, unknown>, body: match[2]!.trim() };
  } catch { return null; }
}

export function compareTrendingSourceContent(content: string, upstream: string): TrendingAttributionResult["match"] | null {
  if (content && content === upstream) return "identical-content";
  const a = splitFrontmatter(content), b = splitFrontmatter(upstream);
  if (!a || !b || !a.body || a.body !== b.body || a.fields.name === b.fields.name) return null;
  const { name: _a, ...fieldsA } = a.fields;
  const { name: _b, ...fieldsB } = b.fields;
  return isDeepStrictEqual(fieldsA, fieldsB) ? "name-only-change" : null;
}

export async function checkTrendingSourceAttribution(input: {
  repo: string; names: string[]; content: string; readme: string | null;
}, deps: TrendingAttributionDependencies): Promise<TrendingAttributionResult> {
  const hints = findTrendingSelfInstallRepos(input.content, input.readme, input.names);
  if (hints.length === 0) return { status: "clear", reason: "no-self-install-conflict" };
  if (hints.length > 1) return { status: "advisory", reason: "ambiguous-self-install" };
  let upstreamRepo: string;
  try { upstreamRepo = await deps.canonicalRepo(hints[0]!); }
  catch (error) {
    if ((error as { status?: number }).status === 404) return { status: "advisory", reason: "upstream-repository-unresolved" };
    throw error;
  }
  if (upstreamRepo.toLowerCase() === input.repo.toLowerCase()) return { status: "clear", reason: "same-canonical-repository" };
  let upstream: Awaited<ReturnType<TrendingAttributionDependencies["upstreamSkill"]>>;
  try { upstream = await deps.upstreamSkill(upstreamRepo, input.names); }
  catch (error) {
    if ((error as { status?: number }).status === 404) return { status: "advisory", reason: "upstream-skill-unresolved", upstreamRepo };
    throw error;
  }
  if (!upstream) return { status: "advisory", reason: "upstream-skill-unresolved", upstreamRepo };
  const match = compareTrendingSourceContent(input.content, upstream.content);
  if (!match) return { status: "advisory", reason: "unconfirmed-source-hint", upstreamRepo };
  return { status: "copy", reason: "confirmed-upstream-copy", match, upstreamRepo,
    upstreamPath: upstream.path, upstreamCommit: upstream.commit };
}
