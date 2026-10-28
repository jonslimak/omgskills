export type PinnedInstall = { repo: string; path: string; commit_sha: string; skill_md_sha: string; skill_tree_sha?: string };
type InstallFields = { github_url?: string; skill_md_path?: string; repo_commit_sha?: string; skill_md_sha?: string; skill_tree_sha?: string };
export const safePart: RegExp;
export function pinnedInstallFor(skill: InstallFields): PinnedInstall | undefined;
export function githubRepo(url: string | undefined): string | undefined;
export function skillMdParts(path: string | undefined): string[] | undefined;
