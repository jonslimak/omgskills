import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalogAdmissionSample } from "./catalog-admission.js";
import type { ProvenanceType, ShadowSkillRecord } from "./types.js";

function skill(id: string, provenanceType: ProvenanceType, stars: number): ShadowSkillRecord {
  return {
    id,
    name: id.split(":").at(-1) ?? id,
    description: "desc",
    github_url: `https://github.com/${id.split(":")[0]}`,
    install_cmd: "install",
    author_handle: "author",
    publisher_handle: "publisher",
    publisher_repo: id.split(":")[0] ?? "owner/repo",
    upstream_repo: null,
    provenance_type: provenanceType,
    author_confidence: "high",
    tags: [],
    stars,
    last_updated: "2026-06-22T00:00:00Z",
    first_seen: "2026-06-22",
  };
}

test("catalog admission sample includes only catalog-like bootstrapped skills", () => {
  const sample = buildCatalogAdmissionSample([
    skill("owner/original:skill", "original", 999),
    skill("owner/catalog:skill", "catalog", 10),
    skill("owner/repackaged:skill", "repackaged", 20),
  ]);

  assert.deepEqual(sample.map((row) => row.id), [
    "owner/repackaged:skill",
    "owner/catalog:skill",
  ]);
});

test("catalog admission sample is capped and deterministic", () => {
  const skills = Array.from({ length: 12 }, (_, index) =>
    skill(`owner/catalog-${String(index).padStart(2, "0")}:skill`, "catalog", index),
  );

  const sample = buildCatalogAdmissionSample(skills);

  assert.equal(sample.length, 10);
  assert.equal(sample[0]?.id, "owner/catalog-11:skill");
  assert.equal(sample.at(-1)?.id, "owner/catalog-02:skill");
});
