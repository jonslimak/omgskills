# Compact Search Catalog (Candidate)

This reader is implemented but not selected by the production MCP export. It
does not add a public endpoint, change default ranking, or migrate the native installer.

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

## Paged Reads (Slice 2 Candidate)

Paging is separately opt-in: use `createOmgskillsServer(reader, { paging: true })`
or `createCompactMcpHandler(loader, { paging: true })` in a local candidate. The
default production handler, package entry points and compact factory without
that option keep the original tool schemas. Nothing activates via an environment
variable. Check `tools/list` for the page capability before sending new requests.

`search_skills`, `list_by_author` and `list_trending` accept `page: {}` for the
first page, then `page: { cursor: previous.page.nextCursor }`. Keep all query,
filter and limit arguments unchanged between pages. Limit still defaults to
20 and caps at 100, but total results are not capped at 100 or 150.

Search and author reads additionally accept `sort`: `relevance` (default),
`trending`, `stars`, `updated`, `added` or `name`. Sorting requires `page`.
Trending preserves its published rank list; it does not accept arbitrary sort.
Existing author/tag/minStars filters and empty-query rules are unchanged.
This slice does not introduce new ranking or `@handle` query parsing.

Paged results retain complete public skill rows and add
`page: { total, hasMore, nextCursor, snapshot, sort }`. Count is the current
page length. The last page has a null next cursor. Text fallback includes this
envelope; nonpaged calls keep their original text-array fallback and schemas.
Filtering/sorting/counting use the search index; only selected IDs are hydrated.

Tokens bind the normalized request, page size, ordering version and complete
snapshot, including independent trending/curation changes. They are not auth
tokens or stored server sessions. An unchanged refresh retains validity; a
changed snapshot returns `catalog_snapshot_changed`, requiring a fresh first
page. Do not append results from different snapshots. Other safe tool errors are
`invalid_cursor`, `paging_not_supported` and `catalog_unavailable`.

Missing optional signals do not produce a complete paging version: paged reads
fail as unavailable while legacy reads retain their existing degraded behavior.
Malformed required data or a failed shard read is not an empty successful page.
The legacy full-loader fallback supports paging with a complete version too;
the native synchronous install-record contract remains unchanged.

Explicit numeric/date sorts put missing or invalid values last; dates require
valid ISO dates/timestamps with explicit zones. Name ties use lowercase NFKC
Unicode code-point order then exact ID, independent of host locale. Relevance
retains legacy score/stars/catalog-order ties. No per-query result cache is added.

Run `node --import tsx scripts/benchmark-catalog-paging.mts` for the offline
full-catalog and MCP demonstration. It compiles the exact slice-1 commit in a
temporary directory, checks all six full index orderings and public first,
middle and last pages, and compares fresh-process initialization and legacy
warm reads. Its receipt records source hashes, timings, selected IDs and limits.
The public APIs remain bounded; private selector access is confined to this
offline verification script.

Portal Load more/sort controls, collection batching, README/detail
content and hosted measurements remain separate work. The current live UI's
30-row limit is not removed merely by adding this candidate API capability.

## Ranked Search (Slice 3 Candidate)

Ranking is a second explicit opt-in, separate from paging:

```ts
const loader = createCompactMcpLibraryLoader({ ranking: true });
const handler = createCompactMcpHandler(loader, { paging: true, ranking: true });
```

The ordinary production export and package entries still select neither
capability. Only a candidate configured for both advertises `ranking: "web-v1"`
on `search_skills`. Omitted ranking preserves slice-2 behavior, including scores,
matching, filters and all nonranked list tools. Check advertised support before
using it; older candidates do not support the new argument.

Send `{ query, ranking: "web-v1", limit: 30, page: {} }`, then repeat unchanged
arguments with the returned cursor. Ranking requires page. A leading `@handle`
becomes an exact author filter; following words remain keywords. A conflicting
explicit author, malformed handle or invalid page is an error, not a broad list.
Public skill rows and the page envelope remain unchanged.

The policy keeps Unicode text, folds app-store spelling variants and removes
generic stopwords only when meaningful words remain. It prioritizes exact IDs,
then complete-term matches, then partial matches, with name/tag weighting above
description/ID/URL text. Negative-score matches are not silently dropped.
Sorting by stars, dates, name or trending preserves slice-2 primary sort rules
over the new matching set. Filter-only relevance retains existing signal order.

The correction policy uses `min(20, log10(stars + 1) * 4)` rather than allowing
repository popularity to dominate relevance. One 25-point corroboration bonus
applies when a query token is exact in both name and catalog tags; repeated tags
cannot stack it. Low-star and collection-origin penalties remain 150 and 250.
There is no language-based penalty. The cursor identity explicitly versions
these scoring rules, so old candidate-policy cursors cannot be reused.

Ranking generation is programmatic opt-in via `buildSearchCatalog(...,
{ generatedAt, ranking: true })`. It adds a hashed `ranking` reference to the v1
descriptor, not properties to its strict nine-field rows. That small asset binds
`collection-origin-v1`, the exact source digest/count and sorted unique known
collection-like IDs derived from existing publisher/provenance fields. It does
not alter source records, attribution, pins or catalog admission. All writers
maintain the extension once present; closure validation and retention include it.
Do not run production publication to create a local benchmark.

A compact snapshot without the extension returns `ranking_not_supported` for
ranked reads; its ordinary reads remain usable. Corrupt referenced ranking data
fails visibly. An existing full-loader fallback may derive the same features
from the raw data it already loads; no compact reader downloads the full catalog
to fill missing ranking fields.

Runtime ranking shares existing prepared text and creates no per-query cache.
It counts all eligible matches but defers partial-match scoring when complete
matches fill the requested page. A bounded prefix selector preserves full-sort
order. Later pages, totals and invalid-rank checks still include partial matches.

Ranking-enabled compact readers reserve at most 1 MiB (and at most one eighth)
of the existing total detail-cache budget for requested, validated raw records.
The shard cache uses the remainder; their combined decoded-byte charge never
exceeds 32 MiB (or the configured lower limit). This avoids repeated shard parsing
for the same selected IDs. It is not a query cache, a larger budget, or a heap
limit. Caches remain reader/snapshot-local; failures and absent IDs are not cached.
Diagnostics expose shard/record bytes and hits separately.

Run `node --import tsx scripts/benchmark-search-ranking.mts` offline. It compiles
slice 2 from Git, tests fixed real-ID expectations and independent scoring,
compares all six legacy tools and public page examples, and records fresh-process
costs. The nine real-ID expectations and original cost budgets are fixed; a
failure is a stop point, not a reason to weaken the check. Top-result review and
hosted measurements remain separate from agreement with a reference scorer.
