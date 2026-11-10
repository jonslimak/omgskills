export function prepareSourceTrending(options: {
  repoRoot: string;
  dataDir: string;
  manifest: Record<string, unknown>;
  skills: Array<{ id: string; repo_slug?: string; github_url?: string }>;
}): void;
