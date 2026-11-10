import { createHash } from "node:crypto";
import { repoFromGithubUrl } from "../policy/effective-policy.js";
import { resolveTrendingMvpPath, type TrendingMvpDependencies, type TrendingMvpRepo } from "./trending-admission-mvp.js";
import { checkTrendingSourceAttribution } from "./trending-attribution.js";

function memoize<K, V>(operation: (key: K) => Promise<V>) {
  const cache = new Map<K, Promise<V>>();
  return (key: K) => {
    let pending = cache.get(key);
    if (!pending) { pending = operation(key); cache.set(key, pending); }
    return pending;
  };
}

export async function createTrendingDependencies(entryCount: number, generatedAt = new Date().toISOString()): Promise<TrendingMvpDependencies> {
  const { octokit } = await import("../client.js");
  const { enrichCandidate } = await import("../enrich.js");
  const { createPinnedPackageMetadataResolver } = await import("./package-metadata.js");
  const { assertGitHubCoreQuotaAvailable } = await import("./github-quota-guard.js");
  const pin = createPinnedPackageMetadataResolver(octokit);
  const repoMetadata = memoize(async (source: string) => {
    const [owner, name] = source.split("/");
    const { data } = await octokit.rest.repos.get({ owner: owner!, repo: name! });
    return data;
  });
  const canonicalRepo = async (source: string) => (await repoMetadata(source)).full_name;
  const lookupRepo = memoize(async (source: string): Promise<TrendingMvpRepo> => {
    const data = await repoMetadata(source);
    const [owner, name] = data.full_name.split("/");
    const { data: commit } = await octokit.rest.repos.getCommit({ owner: owner!, repo: name!, ref: data.default_branch });
    const { data: tree } = await octokit.rest.git.getTree({ owner: owner!, repo: name!, tree_sha: commit.commit.tree.sha, recursive: "true" });
    if (tree.truncated) throw new Error("Incomplete repository tree; defer rather than guess paths");
    const byPath = new Map((tree.tree ?? []).map(row => [row.path, row]));
    const packagesByPath: NonNullable<TrendingMvpRepo["packagesByPath"]> = {};
    for (const row of tree.tree ?? []) {
      if (row.type !== "blob" || !row.path || !row.sha || !(row.path === "SKILL.md" || row.path.endsWith("/SKILL.md"))) continue;
      const parent = row.path === "SKILL.md" ? null : byPath.get(row.path.slice(0, -"/SKILL.md".length));
      const treeSha = row.path === "SKILL.md" ? commit.commit.tree.sha : parent?.type === "tree" ? parent.sha : undefined;
      if (treeSha) packagesByPath[row.path] = { blobSha: row.sha, treeSha };
    }
    const readmePath = (tree.tree ?? []).find(row => row.type === "blob" && row.path?.toLowerCase() === "readme.md")?.path;
    return { repo: data.full_name, commit: commit.sha, readmePath, packagesByPath, paths: (tree.tree ?? []).filter(row => row.type === "blob")
      .map(row => row.path!).filter(path => path === "SKILL.md" || path.endsWith("/SKILL.md")),
      meta: { stars: data.stargazers_count, lastUpdated: data.pushed_at ?? data.updated_at, tags: data.topics ?? [], githubUrl: `https://github.com/${data.full_name}` } };
  });
  const enrich = memoize(async (candidateJson: string) => {
    const { candidate, meta } = JSON.parse(candidateJson);
    return enrichCandidate(candidate, new Map(), new Map(), generatedAt.slice(0, 10), meta);
  });
  const pinCached = memoize(async (input: string) => { const { skill, commit } = JSON.parse(input); return pin(skill, commit); });
  const readSourceFile = memoize(async (input: string) => {
    const { repo, commit, path } = JSON.parse(input);
    const [owner, name] = repo.split("/");
    const { data } = await octokit.rest.repos.getContent({ owner, repo: name, path, ref: commit });
    if (Array.isArray(data) || data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error("Source attribution requires a complete text file");
    }
    const bytes = Buffer.from(data.content, "base64");
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (sha !== data.sha) throw new Error("Source attribution file hash mismatch");
    return { content: bytes.toString("utf8"), sha };
  });
  const inspectAttribution = memoize(async (input: string) => {
    const { skill, commit, entry } = JSON.parse(input);
    const repo = await lookupRepo(repoFromGithubUrl(skill.github_url));
    const source = await readSourceFile(JSON.stringify({ repo: repo.repo, commit, path: skill.skill_md_path }));
    if (source.sha !== skill.skill_md_sha) throw new Error("Source attribution content changed after enrichment");
    const readme = repo.readmePath
      ? (await readSourceFile(JSON.stringify({ repo: repo.repo, commit, path: repo.readmePath }))).content : null;
    return checkTrendingSourceAttribution({ repo: repo.repo, names: [entry.skillId, skill.name], content: source.content, readme }, {
      canonicalRepo,
      upstreamSkill: async (upstreamRepo, names) => {
        const upstream = await lookupRepo(upstreamRepo);
        const matching = [...new Set(names.map(hint => resolveTrendingMvpPath(upstream.paths, hint, upstream.packagesByPath)).filter((path): path is string => !!path))];
        if (matching.length !== 1) return null;
        const path = matching[0]!;
        return { ...(await readSourceFile(JSON.stringify({ repo: upstream.repo, commit: upstream.commit, path }))), path, commit: upstream.commit };
      },
    });
  });
  return { lookupRepo, canonicalRepo,
    enrich: (candidate, meta) => enrich(JSON.stringify({ candidate, meta })), pin: (skill, commit) => pinCached(JSON.stringify({ skill, commit })),
    inspectAttribution: (skill, commit, entry) => inspectAttribution(JSON.stringify({ skill, commit, entry })),
    beforeCandidate: async index => {
      if (index % 5 === 0) await assertGitHubCoreQuotaAvailable(2300, "Trending intake reserve");
      console.log(`  Verifying Trending candidate ${index + 1}/${entryCount}`);
    } };
}
