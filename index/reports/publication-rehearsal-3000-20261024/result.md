# Isolated Local Publication Rehearsal

- Source: 22e53d0c8bcaa7b65d4a029b64cd17db755fbf64.
- Normal promotion, overlay builders, v2/Crawl 4 publishers and SHA-history publisher ran locally with network disabled.
- Both generated tracks: 58,289 skills, exactly +3,000 and zero removals.
- All 55,289 existing v2 records unchanged. All 3,000 additions retain pinned install metadata.
- Both published-data verifiers and publication-impact gates passed without overrides.
- Crawl 4 search catalog/shard closure validates and references the new skills asset. The optional v2 search catalog remains absent, unchanged from baseline.
- Collection assets, memberships, equivalence assets and prior active hashed assets preserved.
- SHA history contains all 3,000 additions. Original staging/rebuild workspace unchanged.
- No commit, push or deployment. Generated data exists only in this isolated worktree.

## Diff Review

- Only generated index data and the two hosted data directories changed; no crawler, client, editorial, or website source changes.
- Normal retention pruned 268 older hashed assets and generated 268 new assets. Prior active assets remain intact.
- Search-catalog, bootstrap, and published-data regression tests: 37 passed, zero failed.
- Remote main still matched the rehearsal source at the final check.
- A rehearsal-only assertion initially assumed v2 had a search catalog. Baseline confirmed v2 has none; the optional-field check was corrected and verification resumed without rerunning publishers.

Next: review the data-only changes for a local commit, then refresh main/live baselines before any push or deployment.
