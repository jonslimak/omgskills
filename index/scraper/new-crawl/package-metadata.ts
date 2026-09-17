import type { Skill } from "../types.js";

export const PINNED_PACKAGE_METADATA_FIELDS = [
  "repo_slug",
  "skill_md_path",
  "repo_commit_sha",
  "skill_tree_sha",
  "skill_md_sha",
  "install_target_name",
] as const;

export type PinnedPackageMetadata = Required<
  Pick<Skill, (typeof PINNED_PACKAGE_METADATA_FIELDS)[number]>
>;

type GitTreeEntry = {
  path?: string;
  type?: string;
  sha?: string | null;
};

type GitHubPackageClient = {
  rest: {
    repos: {
      get: (input: { owner: string; repo: string }) => Promise<{
        data: { full_name?: string | null; default_branch?: string | null };
      }>;
      getCommit: (input: { owner: string; repo: string; ref: string }) => Promise<{
        data: { sha?: string | null; commit?: { tree?: { sha?: string | null } } };
      }>;
    };
    git: {
      getTree: (input: { owner: string; repo: string; tree_sha: string; recursive?: "true" }) => Promise<{
        data: { truncated?: boolean; tree?: GitTreeEntry[] };
      }>;
    };
  };
};

type RepoSnapshot = {
  repoSlug: string;
  owner: string;
  repo: string;
  commitSha: string;
  rootTreeSha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
};

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function hasPinnedPackageMetadata(skill: Partial<Skill>): boolean {
  return Boolean(
    cleanString(skill.repo_slug) ||
      cleanString(skill.repo_commit_sha) ||
      cleanString(skill.skill_tree_sha) ||
      cleanString(skill.install_target_name),
  );
}

export function packageRootFromSkillPath(skillPath: string): string | null {
  const normalized = skillPath.trim();
  if (normalized === "SKILL.md") return ".";
  if (!normalized.endsWith("/SKILL.md")) return null;
  return normalized.slice(0, -"/SKILL.md".length);
}

export function validatePinnedPackageMetadata(skill: Partial<Skill>): string[] {
  if (!hasPinnedPackageMetadata(skill)) return [];

  const values = Object.fromEntries(
    PINNED_PACKAGE_METADATA_FIELDS.map((field) => [field, cleanString(skill[field])]),
  ) as Record<(typeof PINNED_PACKAGE_METADATA_FIELDS)[number], string>;
  const errors: string[] = [];
  const missing = PINNED_PACKAGE_METADATA_FIELDS.filter((field) => !values[field]);
  if (missing.length > 0) errors.push(`missing atomic fields: ${missing.join(", ")}`);
  if (values.repo_slug && !REPO_PATTERN.test(values.repo_slug)) errors.push("invalid repo_slug");
  for (const field of ["repo_commit_sha", "skill_tree_sha", "skill_md_sha"] as const) {
    if (values[field] && !SHA_PATTERN.test(values[field])) errors.push(`invalid ${field}`);
  }
  if (values.skill_md_path) {
    const path = values.skill_md_path;
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      packageRootFromSkillPath(path) === null
    ) {
      errors.push("invalid skill_md_path");
    }
  }
  if (
    values.install_target_name &&
    (!TARGET_PATTERN.test(values.install_target_name) || values.install_target_name === "." || values.install_target_name === "..")
  ) {
    errors.push("invalid install_target_name");
  }
  return errors;
}

export function pinnedPackageMetadataFromSkill(skill: Partial<Skill>): PinnedPackageMetadata | null {
  if (validatePinnedPackageMetadata(skill).length > 0 || !hasPinnedPackageMetadata(skill)) return null;
  return {
    repo_slug: skill.repo_slug!,
    skill_md_path: skill.skill_md_path!,
    repo_commit_sha: skill.repo_commit_sha!,
    skill_tree_sha: skill.skill_tree_sha!,
    skill_md_sha: skill.skill_md_sha!,
    install_target_name: skill.install_target_name!,
  };
}

export function stripPinnedPackageMetadata(skill: Skill): Skill {
  const {
    repo_slug: _repoSlug,
    repo_commit_sha: _repoCommitSha,
    skill_tree_sha: _skillTreeSha,
    install_target_name: _installTargetName,
    ...legacy
  } = skill;
  return legacy;
}

export function preserveLastGoodPinnedSkill(next: Skill, existing: Skill | undefined): Skill {
  if (pinnedPackageMetadataFromSkill(next) || !existing) return next;
  return pinnedPackageMetadataFromSkill(existing) ? existing : next;
}

function repoFromSkill(skill: Skill): { owner: string; repo: string } | null {
  const candidate = skill.repo_slug || (() => {
    try {
      const url = new URL(skill.github_url);
      if (url.hostname.toLowerCase() !== "github.com") return "";
      return url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    } catch {
      return "";
    }
  })();
  const [owner, repo, extra] = candidate.split("/");
  return owner && repo && !extra ? { owner, repo } : null;
}

function skillNameFromId(id: string): string {
  return id.includes(":") ? id.slice(id.indexOf(":") + 1).split("/").at(-1) ?? "" : "";
}

function safeTargetName(skill: Skill, path: string, repo: string): string | null {
  const installTarget = skill.install_cmd.match(/~\/\.claude\/skills\/([^\s'"/]+)/)?.[1]?.trim();
  const root = packageRootFromSkillPath(path);
  const pathTarget = root === "." ? repo : root?.split("/").at(-1);
  for (const value of [installTarget, skillNameFromId(skill.id), pathTarget, skill.name]) {
    if (value && TARGET_PATTERN.test(value) && value !== "." && value !== "..") return value;
  }
  return null;
}

function treeEntryMap(entries: GitTreeEntry[]): Map<string, GitTreeEntry> {
  return new Map(
    entries
      .filter((entry): entry is Required<Pick<GitTreeEntry, "path" | "type">> & GitTreeEntry => Boolean(entry.path && entry.type))
      .map((entry) => [entry.path, entry]),
  );
}

function chooseMatchingPath(skill: Skill, snapshot: RepoSnapshot): string | null {
  const entries = treeEntryMap(snapshot.tree);
  const currentPath = cleanString(skill.skill_md_path);
  const current = currentPath ? entries.get(currentPath) : undefined;
  if (current?.type === "blob" && current.sha?.toLowerCase() === skill.skill_md_sha?.toLowerCase()) return currentPath;
  if (snapshot.truncated) return null;

  const matching = snapshot.tree
    .filter((entry) =>
      entry.type === "blob" &&
      entry.path &&
      (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")) &&
      entry.sha?.toLowerCase() === skill.skill_md_sha?.toLowerCase(),
    )
    .map((entry) => entry.path!)
    .sort();
  if (matching.length === 1) return matching[0]!;
  if (matching.length === 0) return null;

  const idHint = skillNameFromId(skill.id).toLowerCase();
  const hinted = matching.filter((path) => packageRootFromSkillPath(path)?.split("/").at(-1)?.toLowerCase() === idHint);
  return hinted.length === 1 ? hinted[0]! : null;
}

async function targetedTreeEntry(
  client: GitHubPackageClient,
  snapshot: RepoSnapshot,
  path: string,
): Promise<{ blobSha: string; parentTreeSha: string } | null> {
  const parts = path.split("/");
  if (parts.at(-1) !== "SKILL.md") return null;
  let treeSha = snapshot.rootTreeSha;
  for (const [index, part] of parts.entries()) {
    const { data } = await client.rest.git.getTree({
      owner: snapshot.owner,
      repo: snapshot.repo,
      tree_sha: treeSha,
    });
    const entry = data.tree?.find((candidate) => candidate.path === part);
    if (!entry?.sha) return null;
    if (index === parts.length - 1) {
      return entry.type === "blob" ? { blobSha: entry.sha, parentTreeSha: treeSha } : null;
    }
    if (entry.type !== "tree") return null;
    treeSha = entry.sha;
  }
  return null;
}

export function createPinnedPackageMetadataResolver(client: GitHubPackageClient) {
  const snapshots = new Map<string, Promise<RepoSnapshot>>();

  async function snapshotFor(skill: Skill, ref?: string): Promise<RepoSnapshot> {
    const parsed = repoFromSkill(skill);
    if (!parsed) throw new Error(`Cannot resolve repository for ${skill.id}`);
    const key = `${parsed.owner}/${parsed.repo}@${ref ?? "<default>"}`.toLowerCase();
    const existing = snapshots.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const { data: repoData } = await client.rest.repos.get(parsed);
      const repoSlug = cleanString(repoData.full_name) || `${parsed.owner}/${parsed.repo}`;
      const [owner, repo] = repoSlug.split("/");
      if (!owner || !repo) throw new Error(`GitHub returned invalid repository identity for ${skill.id}`);
      const commitRef = ref || cleanString(repoData.default_branch);
      if (!commitRef) throw new Error(`GitHub returned no default branch for ${repoSlug}`);
      const { data: commitData } = await client.rest.repos.getCommit({ owner, repo, ref: commitRef });
      const commitSha = cleanString(commitData.sha);
      const rootTreeSha = cleanString(commitData.commit?.tree?.sha);
      if (!SHA_PATTERN.test(commitSha) || !SHA_PATTERN.test(rootTreeSha)) {
        throw new Error(`GitHub returned invalid commit/tree coordinates for ${repoSlug}`);
      }
      const { data: treeData } = await client.rest.git.getTree({ owner, repo, tree_sha: rootTreeSha, recursive: "true" });
      return {
        repoSlug,
        owner,
        repo,
        commitSha,
        rootTreeSha,
        tree: treeData.tree ?? [],
        truncated: treeData.truncated === true,
      };
    })();
    snapshots.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      snapshots.delete(key);
      throw error;
    }
  }

  return async (skill: Skill, ref?: string): Promise<PinnedPackageMetadata | null> => {
    if (!SHA_PATTERN.test(cleanString(skill.skill_md_sha))) return null;
    const snapshot = await snapshotFor(skill, ref);
    let path = chooseMatchingPath(skill, snapshot);
    let blobSha = "";
    let parentTreeSha = "";

    if (snapshot.truncated) {
      const knownPath = cleanString(skill.skill_md_path);
      if (!knownPath) return null;
      const targeted = await targetedTreeEntry(client, snapshot, knownPath);
      if (!targeted) return null;
      path = knownPath;
      blobSha = targeted.blobSha;
      parentTreeSha = targeted.parentTreeSha;
    } else if (path) {
      const entries = treeEntryMap(snapshot.tree);
      const blob = entries.get(path);
      const root = packageRootFromSkillPath(path);
      const parent = root === "." ? { sha: snapshot.rootTreeSha, type: "tree" } : entries.get(root ?? "");
      blobSha = cleanString(blob?.sha);
      parentTreeSha = cleanString(parent?.type === "tree" ? parent.sha : "");
    }

    if (!path || blobSha.toLowerCase() !== skill.skill_md_sha!.toLowerCase() || !SHA_PATTERN.test(parentTreeSha)) {
      return null;
    }
    const target = safeTargetName(skill, path, snapshot.repo);
    if (!target) return null;

    const metadata: PinnedPackageMetadata = {
      repo_slug: snapshot.repoSlug,
      skill_md_path: path,
      repo_commit_sha: snapshot.commitSha,
      skill_tree_sha: parentTreeSha,
      skill_md_sha: skill.skill_md_sha!,
      install_target_name: target,
    };
    return validatePinnedPackageMetadata(metadata).length === 0 ? metadata : null;
  };
}
