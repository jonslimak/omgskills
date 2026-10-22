type PublicSkill = { id: string; github_url: string };
export type SkillReadme = { markdown: string; repository: string; sourceUrl: string; truncated: boolean };
type Entry<T> = { expires: number; promise: Promise<T> };
type Options = {
  fetcher?: typeof fetch;
  lookupSkill?: (id: string) => Promise<PublicSkill | null>;
  now?: () => number;
  timeoutMs?: number;
};

const characterLimit = 20_000;
const fileByteLimit = 256_000;
const idPattern = /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9_.-]+:[^\x00-\x1f\x7f]{1,800}$/i;

async function boundedText(response: Response, limit: number) {
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
  return Buffer.concat(chunks, bytes).toString("utf8");
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
  const skillCache = new Map<string, Entry<string | null>>();
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
    return { id, github_url: value.skill.github_url };
  }

  async function loadReadme(repository: string): Promise<SkillReadme | null> {
    const [owner, repo] = repository.split("/");
    const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, {
      method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/vnd.github+json", "User-Agent": "omgskills-public-readme" },
    });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error("GitHub unavailable"); }
    const data = JSON.parse(await boundedText(response, 512_000));
    if (data.encoding !== "base64" || typeof data.content !== "string" || typeof data.html_url !== "string"
      || !Number.isSafeInteger(data.size) || data.size < 0 || data.size > fileByteLimit) throw new Error("Invalid README");
    const encoded = data.content.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid README encoding");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > fileByteLimit || bytes.length !== data.size) throw new Error("Invalid README size");
    const source = new URL(data.html_url);
    if (repositoryFromUrl(source.href).toLowerCase() !== repository.toLowerCase()
      || source.pathname.split("/")[3] !== "blob" || source.search || source.hash) throw new Error("Invalid README link");
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!markdown.trim()) return null;
    return { repository, sourceUrl: source.href, truncated: markdown.length > characterLimit,
      markdown: markdown.slice(0, characterLimit).replace(/[\uD800-\uDBFF]$/, "") };
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
      const repository = await cached(skillCache, id, async () => {
        const skill = await (options.lookupSkill ?? lookupPublicSkill)(id);
        if (!skill) return null;
        if (skill.id !== id) throw new Error("Mismatched skill");
        return repositoryFromUrl(skill.github_url);
      });
      if (!repository) return json({ error: "Public skill not found." }, 404);
      const readme = await cached(readmeCache, repository.toLowerCase(), () => loadReadme(repository));
      return json({ skillId: id, readme }, 200, readme ? 600 : 60);
    } catch {
      return json({ error: "README temporarily unavailable. Please try again." }, 503);
    }
  };
}
