import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateSearchCatalog } from "./search-catalog.mjs";

export async function verifyHostedSearchCatalog({ origin, dataDir, fetchImpl = fetch }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("An explicit HTTPS origin is required");
  const manifest = JSON.parse(await readFile(resolve(dataDir, "manifest.json"), "utf8"));
  const closure = validateSearchCatalog(dataDir, manifest);
  if (!closure?.descriptor.ranking) throw new Error("The local Crawl4 bundle is not ranking-ready");
  const base = `${url.origin}/data/crawl4/`;
  async function get(path) {
    const response = await fetchImpl(base + path, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.redirected || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error(`Invalid hosted search asset: ${path}`);
    return response;
  }
  const liveResponse = await get("manifest.json");
  if (/immutable/i.test(liveResponse.headers.get("cache-control") ?? "")) throw new Error("The hosted manifest must remain mutable");
  async function consume(response, limit, keep = false) {
    const hash = createHash("sha256"), chunks = [], reader = response.body?.getReader();
    if (!reader) throw new Error("Empty hosted search response");
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw new Error("Hosted search asset exceeds its verified size"); }
        hash.update(value); if (keep) chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return { bytes, sha256: hash.digest("hex"), ...(keep ? { data: Buffer.concat(chunks) } : {}) };
  }
  const live = await consume(liveResponse, 256 * 1024, true);
  if (!isDeepStrictEqual(JSON.parse(live.data.toString("utf8")), manifest)) throw new Error("Hosted Crawl4 manifest differs from the reviewed snapshot");
  const index = JSON.parse(await readFile(resolve(dataDir, closure.descriptor.details.path), "utf8"));
  const refs = [manifest.searchCatalog, closure.descriptor.sourceSkills, closure.descriptor.search, closure.descriptor.details,
    closure.descriptor.ranking, ...Object.values(index.shards)];
  const results = new Array(refs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, refs.length) }, async () => {
    while (next < refs.length) {
      const i = next++, ref = refs[i], response = await get(ref.path);
      if (!/immutable/i.test(response.headers.get("cache-control") ?? "")) throw new Error(`Hosted hashed asset is not immutable: ${ref.path}`);
      const actual = await consume(response, ref.bytes);
      if (actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256) throw new Error(`Hosted search asset integrity mismatch: ${ref.path}`);
      results[i] = { path: ref.path, ...actual };
    }
  }));
  return { origin: url.origin, source: closure.descriptor.sourceSkills, assets: results,
    boundary: "Read-only hosted static verification, not API activation or a latency measurement." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [origin, dataDir, ...extra] = process.argv.slice(2);
  if (!origin || !dataDir || extra.length) throw new Error("Usage: verify-hosted-search-catalog.mjs <https-origin> <local-crawl4-data-dir>");
  verifyHostedSearchCatalog({ origin, dataDir }).then(receipt => console.log(JSON.stringify(receipt, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
