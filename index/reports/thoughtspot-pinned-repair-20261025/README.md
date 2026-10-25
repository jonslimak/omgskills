# ThoughtSpot Pinned Install Repair

Status: verified locally only. Publication and deployment have not been performed.

## Scope

Repair exactly three legacy records from baseline commit
`f65456479b2852085b642ea24436dc03f5d2c248`:

- `thoughtspot/thoughtspot-agent-skills:ts-coach-model`
- `thoughtspot/thoughtspot-agent-skills:ts-convert-from-snowflake-sv`
- `thoughtspot/thoughtspot-agent-skills:ts-object-answer-promote`

Their legacy installation paths no longer exist on the default branch. The
reviewed historical commits contain exactly the already-indexed file content.
This repair pins those versions; it does not upgrade to renamed/current skills.

The existing `crawl4:backfill-package-metadata` command was run with exact
`--skill-id` selections and per-skill `--commit-ref` values. It resolved all three
atomically, passing the normal quota floor (4,434 requests remaining before apply).
No crawler source code, IDs, descriptions, content hashes, or legacy install
commands changed.

## Evidence

- `verified-package-metadata.overlay.json`: generated, complete six-field
  install coordinates for only the three reviewed IDs.
- `result.json`: independent commit/tree/source-blob checks and whole-catalog
  comparison after applying the tool-generated overlay in memory.
- The actual local operator output is
  `index/shadow/package-metadata.overlay.json`, with its normal backfill report
  alongside it. These ignored operational files remain in this isolated worktree.

Verification: 32 focused metadata/cutover tests passed; index typecheck passed.
All three source blobs were fetched at their exact commits and independently
hashed with the Git blob header. The package trees contain the matching
`SKILL.md` entries. Applying the overlay preserves all 58,289 records and changes
only five optional install-coordinate fields on these three records. The other
58,286 records are byte-for-byte unchanged under JSON serialization.

The structural skill checks from `validateCutoverOutputs` passed on the merged
catalog. No full shadow rebuild or repo/signal reconciliation was performed;
this is not a full-crawl validation claim.

## Later Integration

These report files are evidence, not automatically loaded crawler policy. Before
using the three tuples in a shared writer, recheck each current skill's ID,
repository and content hash against this evidence. If anything differs, stop and
review rather than forcing stale coordinates onto newer content.

Merge only the reviewed metadata through the existing overlay mechanism. Never
copy this worktree's full catalog or full generated overlay over newer shared
state. Preserve every unrelated record and existing overlay entry. Run normal
cutover/publication checks before any separately approved publish.

No production data, hosted assets, app binaries, updater files, or shared dirty
checkout were changed by this local repair.
