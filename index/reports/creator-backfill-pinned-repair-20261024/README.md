# Creator Backfill Install Metadata Evidence

Historical operator evidence for 3,000 previously reviewed, locally staged skills.
These reports are not crawler configuration and do not publish or admit skills.

## Sequence

1. `../creator-backfill-pinned-pilot-20261024/result.json`: five real skills
   verified in isolation against their reviewed historical commits, including
   independent source blob and package-tree checks.
2. `batch-01.json` through `batch-24.json`: the remaining 2,995 skills resolved
   in exact-selection batches of at most 125, with the existing quota guard.
3. `result.json`: all 3,000 metadata tuples verified in an isolated overlay.
4. `../creator-backfill-pinned-reconcile-20261024/result.json`: the verified
   tuples applied to the shared local skill overlay and cutover output using
   revision guards and the existing rollback-safe transaction helper.

The pilot and isolated repair results describe their stage at that time, not the
final shared state. In particular, the pilot's legacy count and the repair's
"not yet integrated" location were superseded by the reconciliation result.

## Artifacts

- `reviewed-pins.json`: exact reviewed IDs, repositories, paths, commit SHAs and
  blob SHAs, plus the verified overlay's SHA-256 digest.
- `verified-package-metadata.overlay.json`: complete six-field pinned metadata
  tuples for those IDs, retained as evidence and for guarded recovery.
- Batch and result JSON/Markdown: validation outcomes and operation boundaries.

The source fix was tested as `3c42452b` and reconciled onto local main as
`fe4da682`. Neither evidence storage nor that fix imports this overlay into a
scheduled run automatically. Any reuse must first match each current skill's
ID, repository, path and blob SHA against the reviewed pins, then validate the
resulting cutover output. Do not copy an old full cutover catalog over a newer
baseline.

At reconciliation, cutover held 50,690 skills and the skill overlay held 3,032.
Only the 3,000 selected skills' optional install metadata changed. IDs, content,
repo membership, the other 32 overlay skills, baseline data and published assets
were unchanged. Rollback and stale-write rejection were rehearsed successfully.

No combined crawl, promotion, publication or deployment was run for this repair.
Raw logs, machine-state snapshots, backups and scratch scripts remain local and
are intentionally excluded from this evidence commit.
