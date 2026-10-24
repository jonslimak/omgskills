# Current-Baseline Shadow Rebuild Evidence

Historical operator evidence from an isolated local rebuild on 2026-10-24.
These reports are not crawler configuration or published data.

The source change reuses the run's validated trusted-seed snapshot for
provenance, repository indexing, discovery, refresh and preview generation.
There is no global cache. Standalone finalization loads one snapshot per call.
Regression tests verify identical output, one load per batch, reuse of an
injected snapshot and fresh loading between separate calls.

The existing `--cadence=combined --only-package-metadata-overlay` mode rebuilt
from the committed 52,284-skill baseline and the reviewed staged overlays.
Network access was blocked during the run. The rebuilt cutover contains 55,289
skills: the baseline, all 3,000 reviewed campaign additions and five earlier
staged additions. No baseline IDs or existing collection members were lost.
All reviewed pinned coordinates and creator coverage were checked again.

Included evidence:

- `result.json` and `result.md`: rebuild scope and validation results.
- `review-issues.json`: empty missing-ID, metadata, policy and validation lists.
- `publication-impact.*.json`: in-memory count/membership projections for both
  tracks. These are not full checks against newly published hashed assets.
- `artifact-integrity.json`: hashes of the tested source files, baseline,
  creator registry, input overlays and rebuilt shadow artifacts.

The recorded source commit is the parent revision. `sourceModified` and the
source hashes identify the tested fix included in this evidence commit.
The recorded rebuild took about nine seconds and made two creator-policy file
reads, rather than reloading policy once per skill.

Full catalog files, operational overlays, raw logs, backups and scratch scripts remain
local. No promotion, publication, deployment or shared-checkout mutation was
performed. A future publication must use current inputs and rerun its normal
asset, policy, cutover and publication-impact gates.
