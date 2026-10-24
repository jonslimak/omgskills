# Five-Skill Pinned Metadata Pilot

Verified: 2026-10-24T11:04:07.878Z

- Five real skills resolved at their reviewed historical commits; live blob and package-tree hashes match.
- Patched creator finalization accepts all five complete metadata tuples.
- Skill IDs, source paths, content hashes and other fields are unchanged. No unselected row changed.
- In-memory cutover validation passes. No combined crawl or publish ran.
- Overlay exists only in this isolated workspace. Shared staged data and production are unchanged.
- All 3,000 shared staged skills still require the separately approved metadata repair.

- carta/plugins:plugins/carta-cap-table/skills/carta-compensation-rolematcher: 179e51e07ffea09c7c205e2cb01c6fa9d518f1df
- qdrant/skills:skills/qdrant-clients-sdk: 75c3322d562210953adb1717bf91d1c09fd4b77f
- qdrant/skills:skills/qdrant-edge: 75c3322d562210953adb1717bf91d1c09fd4b77f
- confluentinc/agent-skills:skills/confluent-cloud-cdc-tableflow: f3d95b7e6855b690b7670ecee033404e082ab169
- confluentinc/agent-skills:skills/confluent-cloud-flink-sql: f3d95b7e6855b690b7670ecee033404e082ab169
