# Compact Search Catalog (Candidate)

This reader is implemented but not selected by the production MCP export. It
does not add a public endpoint, change ranking, or migrate the native installer.

## Data

Each participating track may add a `searchCatalog` reference to its manifest:

- A hashed descriptor binds the source skills file, search projection and detail
  index to one snapshot, with byte counts and SHA256 digests.
- The projection retains full descriptions and the existing ranking inputs.
- Complete original records live in 256 SHA256-first-byte ID buckets. Empty
  buckets are omitted; records and IDs are not normalized or renamed.
- Assets stay within the same track directory. The existing full skills asset
  remains available to Mac and legacy readers.

The existing publishers opt in to first generation with
`OMGSKILLS_SEARCH_CATALOG=1`. Once a track has the reference, its writers maintain
it even without that variable. This flag generates data; it does not select the
compact runtime. Do not run a production publisher merely to benchmark it.

Publication validates both current and previous complete closures before atomic
manifest activation. Retention keeps those generations, generations younger than
24 hours, and files whose ownership cannot be established. Repeated no-op
publication must not prune the previous generation.

## Reader

`loadCatalogReader` returns the compact reader when the manifest has a valid
descriptor, or the existing full reader when the descriptor is absent. Invalid
compact metadata fails that snapshot, rather than mixing old and new assets.

Search uses the existing scoring class, then hydrates only selected records to
preserve today's MCP result contract. Exact-ID detail needs one shard after
initialization. All six tool schemas and their synchronous legacy callers remain
supported. `getRawRecord` retains unknown fields for internal consumers; it does
not expose new public MCP fields.

Shard reads are deduplicated, limited to four concurrent fetches, and cached in
an LRU capped at 32 MiB of decoded JSON bytes. This is not a JavaScript heap cap.
Failed fetches are retried; a failed refresh preserves the last usable snapshot.
Individual cancellation does not abort another consumer's shared fetch.

`createCompactMcpLibraryLoader` and `createCompactMcpHandler` are candidate-only
factories. The default handler still uses `loadProductionMcpLibrary`.
`createMcpHandler` retains its synchronous-reader contract for the separate
install-record work. When merging that work, keep its dispatch in this legacy
wrapper, not in the common async read handler. Preserve `repo_slug` and
`install_target_name` in the legacy field projection.

## Offline Verification

Use the repository's supported Node version (at least 20.19; measurements used
24.19) and install root plus `mcp/` dependencies first:

```sh
node --import tsx scripts/benchmark-search-catalog.mts
npm --prefix mcp test
npm run test:mcp-production
npm run test:published-data
npm run test:public-catalog
npm run test:deploy-safety
npx tsc --noEmit
```

The benchmark generates only temporary files. Its receipt contains exhaustive
raw/enriched parity, fixed query/list comparisons, artifact hashes, implementation
hashes, and fresh-process measurements. First-use shard costs and prewarmed
queries are reported separately. It uses local filesystem-backed fetches, not
hosted latency or compressed transfer measurements.

At the initial 51,981-record snapshot, the projection is about 33 MB rather than
the full 81 MB catalog. Added static assets total about 106 MB per generation
before reuse. A cold MCP search also reads signals and selected detail shards;
do not report projection size as total request cost or promise lower retained
heap. Hosted measurements and activation require a separately reviewed combined
deployment, with existing release and install surfaces preserved.
