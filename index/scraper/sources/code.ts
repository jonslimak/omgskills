import { octokit } from "../client.js";

export interface CodeHit {
  id: string;
  path: string;
  github_url: string;
  author_handle: string;
}

function isValidSkillPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function deriveId(repoFullName: string, path: string): string {
  if (path === "SKILL.md") return repoFullName;
  const parts = path.split("/");
  const skillName = parts[parts.length - 2];
  return `${repoFullName}:${skillName}`;
}

async function collectCodeHits(q: string, seen: Set<string>, results: CodeHit[]) {
  const iter = octokit.paginate.iterator(octokit.rest.search.code, {
    q,
    per_page: 100,
  });
  try {
    for await (const { data } of iter) {
      for (const hit of data) {
        if (!isValidSkillPath(hit.path)) continue;
        const id = deriveId(hit.repository.full_name, hit.path);
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          path: hit.path,
          github_url: hit.repository.html_url,
          author_handle: hit.repository.owner?.login ?? "",
        });
      }
    }
  } catch (err: any) {
    // GitHub caps code search at 1000 results — 404 on page 11+ is expected
    if (err?.status !== 404) throw err;
  }
}

// Fingerprint queries — each targets Claude Code-specific SKILL.md content.
// Size buckets split the ~/.claude/skills query to maximise results under the 1000-result cap.
// Over-cap buckets still yield 1000 results; nightly accumulation covers the remainder.
const FINGERPRINT_QUERIES = [
  // preamble-tier is exclusive to Claude Code SKILL.md format — 784 results, all genuine
  "preamble-tier filename:SKILL.md",

  // ~/.claude/skills in SKILL.md content = install path reference, very high precision
  "~/.claude/skills filename:SKILL.md size:<1000",
  "~/.claude/skills filename:SKILL.md size:1000..2000",
  "~/.claude/skills filename:SKILL.md size:2001..3500",
  "~/.claude/skills filename:SKILL.md size:3501..5000",
  "~/.claude/skills filename:SKILL.md size:5001..8000",
  "~/.claude/skills filename:SKILL.md size:8001..15000",
  "~/.claude/skills filename:SKILL.md size:15001..30000",
  "~/.claude/skills filename:SKILL.md size:>30000",
];

export async function searchBySkillMdFilename(): Promise<CodeHit[]> {
  const seen = new Set<string>();
  const results: CodeHit[] = [];

  // Broad search — catches skills in subdirectories (e.g. .claude/skills/*)
  await collectCodeHits("filename:SKILL.md", seen, results);

  // Fingerprint queries — high-precision, cover root-level and content-identified skills
  for (const q of FINGERPRINT_QUERIES) {
    await collectCodeHits(q, seen, results);
  }

  return results;
}
