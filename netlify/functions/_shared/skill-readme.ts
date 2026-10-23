type PublicSkill = { id: string; github_url: string; skill_md_path?: string | null };
/** skill-readme: the skill folder's README; skill: its SKILL.md; repository: the repo README. */
export type ReadmeKind = "skill-readme" | "skill" | "repository";
export type SkillReadme = { markdown: string; repository: string; sourceUrl: string; truncated: boolean; kind: ReadmeKind };
/** The skill's SKILL.md and its human README, shown as two tabs in the app. */
export type SkillDocuments = { skill: SkillReadme | null; readme: SkillReadme | null };
type SkillSource = { repository: string; folder: string; skillFile: string | null };
type Entry<T> = { expires: number; promise: Promise<T> };
type Options = {
  fetcher?: typeof fetch;
  lookupSkill?: (id: string) => Promise<PublicSkill | null>;
  now?: () => number;
  timeoutMs?: number;
};

const characterLimit = 20_000;
const fileByteLimit = 256_000;
// raw.githubusercontent.com has no per-IP API quota (the REST API allows 60/hour
// unauthenticated). HEAD resolves the default branch; names are case-sensitive.
const readmeNames = ["README.md", "readme.md", "Readme.md", "README.markdown", "README.mdx", "README.txt", "README"];
const folderReadmeNames = ["README.md", "readme.md"];
// `owner/repo` (a repo-level skill) or `owner/repo:skill/path`.
const idPattern = /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9_.-]+(?::[^\x00-\x1f\x7f]{1,800})?$/i;
const frontmatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** A catalog SKILL.md path, as safe relative segments; anything else falls back to the repo README. */
function skillFileSegments(value: unknown): string[] | null {
  if (typeof value !== "string" || value.length > 800 || /[\\\x00-\x1f\x7f]/.test(value)) return null;
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  return /^skill\.md$/i.test(segments.at(-1)!) ? segments : null;
}

async function boundedBytes(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("Response too large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

async function boundedText(response: Response, limit: number) {
  return (await boundedBytes(response, limit)).toString("utf8");
}

function repositoryFromUrl(value: string) {
  const url = new URL(value);
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port
    || !owner || !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(owner)
    || !repo || !/^[a-z0-9_.-]+$/i.test(repo) || repo === "." || repo === "..") throw new Error("Invalid repository");
  return `${owner}/${repo}`;
}

export function createSkillReadmeHandler(options: Options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const skillCache = new Map<string, Entry<SkillSource | null>>();
  const readmeCache = new Map<string, Entry<SkillReadme | null>>();
  let active = 0;

  function cached<T>(cache: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.promise;
    if (active >= 16) return Promise.reject(new Error("Reader busy"));
    cache.delete(key);
    while (cache.size >= 128) cache.delete(cache.keys().next().value!);
    active++;
    const entry: Entry<T> = { expires: Infinity, promise: Promise.resolve(null as T) };
    entry.promise = load().then(value => {
      entry.expires = now() + (value === null ? 60_000 : 600_000);
      return value;
    }, error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }).finally(() => { active--; });
    cache.set(key, entry);
    return entry.promise;
  }

  async function lookupPublicSkill(id: string): Promise<PublicSkill | null> {
    // Reuse the public catalog service, without loading another full search index here.
    const response = await fetcher("https://omgskills.com/mcp", {
      method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_skill", arguments: { id } } }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Catalog unavailable"); }
    const envelope = JSON.parse(await boundedText(response, 128_000));
    const value = envelope.result?.structuredContent;
    if (envelope.error || envelope.result?.isError || envelope.id !== 1) throw new Error("Invalid catalog result");
    if (value?.found === false && value.skill === null) return null;
    if (value?.found !== true || value.skill?.id !== id || typeof value.skill.github_url !== "string") throw new Error("Invalid catalog skill");
    return { id, github_url: value.skill.github_url, skill_md_path: value.skill.skill_md_path ?? null };
  }

  async function firstFile(repository: string, paths: string[], signal: AbortSignal) {
    const [owner, repo] = repository.split("/");
    const repositoryPath = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    for (const path of paths) {
      signal.throwIfAborted();
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const response = await fetcher(`https://raw.githubusercontent.com/${repositoryPath}/HEAD/${encoded}`, {
        method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        signal,
        headers: { Accept: "text/plain", "User-Agent": "omgskills-public-readme" },
      });
      if (response.status === 404) { await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); throw new Error("GitHub unavailable"); }
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response, fileByteLimit));
      return { markdown, sourceUrl: `https://github.com/${repositoryPath}/blob/HEAD/${encoded}` };
    }
    return null;
  }

  function readme(repository: string, kind: ReadmeKind, file: { markdown: string; sourceUrl: string }): SkillReadme | null {
    const markdown = kind === "skill" ? file.markdown.replace(frontmatter, "").replace(/^(?:[ \t]*\r?\n)+/, "") : file.markdown;
    if (!markdown.trim()) return null;
    return { repository, kind, sourceUrl: file.sourceUrl, truncated: markdown.length > characterLimit,
      markdown: markdown.slice(0, characterLimit).replace(/[\uD800-\uDBFF]$/, "") };
  }

  // Load both documents in parallel: the SKILL.md (what the agent reads and what gets
  // installed) and the human README (the skill folder's, else the repository's).
  async function loadDocuments({ repository, folder, skillFile }: SkillSource) {
    const signal = AbortSignal.timeout(timeoutMs);
    const key = repository.toLowerCase();
    const [skillResult, readmeResult] = await Promise.allSettled([
      skillFile ? cached(readmeCache, `${key}:skill:${skillFile}`,
        () => firstFile(repository, [skillFile], signal).then(file => file && readme(repository, "skill", file))) : null,
      cached(readmeCache, `${key}:readme:${folder}`, async () => {
        if (folder) {
          const own = await firstFile(repository, folderReadmeNames.map(name => `${folder}/${name}`), signal);
          const ownReadme = own && readme(repository, "skill-readme", own);
          if (ownReadme) return ownReadme;
        }
        const repo = await firstFile(repository, readmeNames, signal);
        return repo && readme(repository, "repository", repo);
      }),
    ]);
    const skill = skillResult.status === "fulfilled" ? skillResult.value : null;
    const readmeDoc = readmeResult.status === "fulfilled" ? readmeResult.value : null;
    const partial = skillResult.status === "rejected" || readmeResult.status === "rejected";
    if (!skill && !readmeDoc && partial) throw new Error("Skill documents unavailable");
    return { documents: skill || readmeDoc ? { skill, readme: readmeDoc } : null, partial };
  }

  function json(body: unknown, status = 200, ttl = 0) {
    return Response.json(body, { status, headers: {
      "Cache-Control": ttl ? `public, max-age=${Math.min(ttl, 60)}` : "no-store",
      "Netlify-CDN-Cache-Control": ttl ? `public, durable, max-age=${ttl}` : "no-store",
      "Netlify-Vary": "query=id",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      ...(status === 405 ? { Allow: "GET" } : {}),
    } });
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return json({ error: "Only public README reads are supported." }, 405);
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    if (params.getAll("id").length !== 1 || [...params.keys()].some(key => key !== "id") || !idPattern.test(id)) {
      return json({ error: "A public catalog skill ID is required." }, 400);
    }
    try {
      const source = await cached(skillCache, id, async () => {
        const skill = await (options.lookupSkill ?? lookupPublicSkill)(id);
        if (!skill) return null;
        if (skill.id !== id) throw new Error("Mismatched skill");
        const segments = skillFileSegments(skill.skill_md_path);
        return { repository: repositoryFromUrl(skill.github_url),
          folder: segments ? segments.slice(0, -1).join("/") : "", skillFile: segments ? segments.join("/") : null };
      });
      if (!source) return json({ error: "Public skill not found." }, 404);
      const { documents: doc, partial } = await loadDocuments(source);
      return json({ skillId: id, skill: doc?.skill ?? null, readme: doc?.readme ?? null }, 200, partial ? 0 : doc ? 600 : 60);
    } catch {
      return json({ error: "README temporarily unavailable. Please try again." }, 503);
    }
  };
}
