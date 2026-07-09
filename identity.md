# Skill Identity Resolution

## The problem

Our system has not solved an integral way to map installed skill data back to GitHub-url data.

Two causes:

- people already have skills installed when they first download the tool
- many skills are made locally and only exist locally

A locally installed skill is just a folder with a `SKILL.md`. It carries no catalog ID and no `github_url`. Today those skills stay unresolved — the client treats them as local, and every layer built on catalog IDs (groups, editorial, web library) can't see them.

## Constraints

- We do not want to become a duplicate repo that stores skill content
- Resolution must not require the server to see skill content
- Unresolved must remain a valid, honest terminal state — no fabricated mappings
- The catalog skill ID stays the universal key across all surfaces

## The key insight

The catalog already stores `skill_md_sha` — a content hash of every `SKILL.md` it crawls.

Content addressing is the bridge between "a folder on someone's disk" and "a catalog entry with a github_url" — without hosting any content. If the client hashes a local `SKILL.md` the same way the crawler does, identity resolution becomes a lookup.

### Hash contract

`skill_md_sha` is the lowercase, 40-character Git blob SHA-1 of the exact
`SKILL.md` bytes:

```text
SHA1("blob " + byteLength + NUL + rawBytes)
```

There is no newline, Unicode, whitespace, frontmatter, or Markdown normalization.
The crawler hashes the downloaded bytes before decoding them as UTF-8, and the
client hashes the local file bytes directly. The hash identifies one exact file
version; it does not establish authorship or logical equivalence.

## The resolution ladder

The client walks these steps locally, strongest signal first. Each skill ends in exactly one state: exact-resolved, user-confirmed, or local-only.

### 1. Install provenance — exact

Skills installed through omgskills already know their catalog ID at install time.

Only helps going forward. Zero cost.

### 2. Git inspection — exact

Many pre-existing installs are symlinks into a cloned repo, or live inside one. The scanner already tracks `isSymlink`.

- follow the symlink to its target
- find the enclosing `.git`
- read `remote origin` → `owner/repo`
- combine with the skill folder name → catalog ID

Exact, offline, zero network. Likely resolves a large share of pre-existing installs, because `git clone` was the default install method before the tool existed.

Rename caveat: some catalog IDs were minted under a repo's old name (verified: ~770 rows are GitHub rename redirects). A clone under the new name won't match the old-name ID at this step — the content-hash step below usually catches it. Publishing the crawler's repo-alias map (old → new) as a small asset would make this step exact for renames too.

### 3. Content-hash match — exact, version-pinned

Hash the local `SKILL.md` the same way the crawler computes `skill_md_sha`. Look it up in the cached catalog.

**One hash can match many catalog entries** — ~24% of the library is byte-identical copies (crawl-audit finding), skewed toward the most popular skills. The rule:

- exactly one match → resolved, with the exact version identified
- multiple matches → **ambiguous** — a distinct state, never a silent guess

Ambiguous upgrades to resolved automatically once canonical attribution ships (`crawl-audit.md` Phase 3.1). Until then the ambiguous count is free telemetry for how urgent that work is.

Limitation: the catalog only holds the latest sha per skill. A six-month-old install won't match after the skill updates upstream. The sha history index (below) removes this limitation.

### 4. Fuzzy match — probabilistic, confirm-once

Name + frontmatter description similarity against the catalog, producing a candidate with a confidence score.

Never silently trusted:

- surface as "this looks like `openai/codex-universal` — link it?"
- one tap confirms
- confirmed mapping is stored locally, permanent

Catches locally edited copies where the hash no longer matches.

### 5. Unresolved — valid terminal state

Genuinely local-only. The schema already models this correctly (`is_local_only`, nullable `catalog_skill_id`).

Not a failure. No fabricated URLs.

## Current system: sha history index

The SHA history index and exact client lookup are implemented. The published v1
asset keeps the deployed shape:

```text
shaToSkillIds: sha → [skill ids]
```

It is append-only and intentionally allows multiple IDs for one SHA. The current
client resolves one match and reports multiple matches as ambiguous.

Canonical attribution must extend this contract additively rather than changing
the existing map that clients already decode:

```
canonicalBySha?: sha → {
  skillId,
  confidence,
  reason
}
```

Do **not** replace `shaToSkillIds` with a flat `sha → single id` map. Existing
clients need the full membership list, and unresolved ambiguity must remain honest.

Properties:

- a few bytes per version — an index, not a mirror; does not make us a content host
- append-only — shas are never removed while the skill exists
- makes resolution version-proof: any `SKILL.md` the crawler has ever seen resolves, no matter how stale the local copy
- client-side lookup against published data, same as everything else

The initial asset is published. Wiring `publish:sha-history` into every scheduled
publish remains a separate operational follow-up; until then newly observed
versions are not guaranteed to be appended automatically.

## Design properties

- **Resolution is entirely client-side** against data we already publish. The server never sees skill content. We stay a catalog, not a host.
- **It degrades honestly.** Exact → confirmed → local. A resolution-confidence field extends the existing `author_confidence` pattern naturally.
- **It composes with every surface.** A resolved skill gains a catalog ID, which is all that groups, editorial, and the web library need.

## Cross-agent identity: the same skill in Claude and Codex formats

Claude and Codex skills use slightly different formats. Ported skills are not word-for-word replicas, so content hashing alone will never link them. This is a third identity layer:

- **File identity** — `skill_md_sha` (exact content)
- **Catalog identity** — skill ID (a specific file at a specific URL)
- **Logical identity** — the skill as a concept, spanning its Claude and Codex ports

Note the missing link between the first two: one file identity can belong to **many** catalog identities (byte-identical copies across repos — ~24% of the library). **Canonical attribution** is the rule that picks the original author's copy as the winner (`crawl-audit.md` Phase 3.1). It is the sibling of the equivalence clusters below: duplicate clusters group same-content entries, equivalence clusters group same-concept entries. Same design — derived grouping metadata over catalog rows, never merging records — one shadow-validated publish path for both.

### What exists today

The skill groups dashboard solved this locally (`groupSyncedSkills` in `portal/src/main.tsx`):

- hard gate: normalized name equality
- then: same `githubUrl`, or fuzzy description match (exact / containment / word-overlap ≥ 72–80%)
- display merge: prefer codex variant as representative, longest description, union of sources, all underlying IDs kept

### Why the heuristic cannot be generalized as-is

- **Scope safety.** The dashboard matches within one user's synced skills — a few dozen items installed by the same person, so a name+description match carries a strong prior. The same fuzzy logic across 50K catalog skills would false-positive constantly (the library is full of similarly named `code-review` / `commit` skills by different authors). Same algorithm, different scope, different answer quality.
- **Drift.** Reimplementing a subtle fuzzy algorithm in Swift means the same skill pair can show merged on the web and separate in the client. A general rule should be computed once, not recomputed per surface.
- **Weak signals.** The portal frontend only sees name, description, and URL. The catalog has much stronger signals: `upstream_repo`, `provenance_type`, author identity, repo structure. Cross-agent ports are usually the same repo shipping both formats, or a fork with an upstream link.

### The rule, split by scope

**Catalog skills — precompute at publish time.**
Crawl 4 clusters equivalent skills during publish using strong signals (same repo / upstream link / author + normalized name; descriptions as tiebreaker) and publishes the clusters as a small side asset, like `skillSignals`. Deterministic, inspectable in shadow output. Every surface — client, portal, web library — reads the clusters instead of running its own fuzzy logic.

Web library bonus: equivalent skills share one page with both install commands, instead of two thin near-duplicate pages competing in search.

**Local skills — one specified rule, small scope.**
The only case that cannot be precomputed: matching a user's local Claude copy against their local Codex copy. Keep the portal's heuristic for this, but write it down as a shared spec (normalization, thresholds, gate order) so the Swift and TypeScript implementations give identical answers. This scope — within one user's installs — is where the loose heuristic is safe.

**Never merge records.**
Variants are genuinely different files with different install commands — a user installs the Codex variant into Codex. Logical identity is derived metadata over catalog entries, not a replacement for them. Each variant stays a real catalog row; equivalence is a grouping layer, consistent with the no-duplication principle.

### Grouping asset design

Exact duplicates and logical equivalents belong to the same derived-relations
family, but they should not duplicate storage unnecessarily:

- exact duplicate membership stays in `shaHistory`; future `canonicalBySha`
  records the preferred current catalog ID
- logical equivalents use a future `skillEquivalence` side asset because their
  files have different SHAs and remain independently installable variants

The future equivalence asset uses this minimal shape:

```text
{
  version,
  generatedAt,
  groups: [{
    id,
    memberSkillIds,
    confidence,
    evidence
  }]
}
```

Shared invariants:

- all member IDs exist in the current suppression-filtered Crawl 4 output
- each group contains at least two unique, deterministically sorted IDs
- group IDs are deterministic
- grouping never rewrites, merges, or deletes skill records
- unresolved or weak matches remain ungrouped
- all new assets are shadow-generated and validated before publication

## Personal skills and P2P sharing (parked, direction noted)

Set aside for now, but content hashing gives a clean seam when we get there:

- **Catalog skills travel through groups as IDs** — tiny, no hosting, already works
- **Personal skills are the only case that ever needs content transfer.** The cleanest move: "publish to your own GitHub (repo or gist) and it becomes a catalog-resolvable skill." That pushes hosting back to GitHub, where it belongs.
- **Hash reconciliation is automatic.** If someone's personal skill later appears on GitHub, the content hash reconciles the two identities without migration.

The trap to avoid: letting the portal DB quietly become the content store because it's convenient for group sharing. That is the duplicate-repo outcome by the back door.

## Implementation guidance: keeping resolution cheap

Resolution is one user's installed skills (typically 5–50) against lookup tables — not a library-scale comparison. Done right it costs tens of milliseconds and zero server compute. The rules that keep it that way:

- **Build lookups in the existing decode pass.** The client already decodes the full catalog at launch and builds an FTS index. Build the `sha → id` and `normalized name → ids` dictionaries in that same loop — no separate pass over the library.
- **Bulk pass runs once, in the background.** First resolution runs as a detached background task after library load, same pattern as the FTS index build. Never blocks UI.
- **Cache by local content sha.** Persist resolved mappings keyed by the local `SKILL.md` sha. A skill re-resolves only when its content changes or it is newly discovered. Unchanged skills are a cache read.
- **Catalog updates do not invalidate resolutions.** Already-resolved skills stay resolved. A fresh catalog only triggers a retry of the *unresolved* leftovers — a handful of items, not the full set.
- **Name-gate before any description comparison.** Fuzzy matching only compares against catalog skills sharing the normalized name — never scans the library.
- **No server involvement.** The entire ladder runs client-side against published data. Per-user cost to us: zero API calls, zero backend compute.

## Path forward

Current implementation status and remaining order:

1. **Done: verify hash compatibility** — Swift and Node use the same raw-byte Git blob SHA contract and known test vector
2. **Done: ship the exact ladder in the client scanner** — install provenance, Git inspection, and SHA lookup resolve locally; multi-ID matches remain ambiguous
3. **Partial: publish SHA history** — the v1 asset exists with `shaToSkillIds`; scheduled append automation remains to be wired separately
4. **Canonical attribution** (`crawl-audit.md` Phase 3.1) — pick the original author's copy per duplicate cluster; annotate the sha index with `canonicalId`, upgrading ambiguous resolutions to resolved. Before or alongside this step is fine; it must land before multi-id hash matches are treated as authoritative
5. **Add the confirm-once fuzzy UX** — only after measuring how much steps 1–4 leave unresolved
6. **Propagate resolution into synced_skills** — resolved IDs flow into `catalog_skill_id` on sync, making groups catalog-aware for previously unresolvable skills
7. **Add cross-agent equivalence clusters to Crawl 4 publishing** — shadow-first like every other Crawl 4 change, sharing the grouping-asset design with duplicate clusters (step 4); validate cluster quality in shadow reports before clients consume it
8. **Extract the local-match heuristic into a shared spec** — document normalization, thresholds, and gate order from `groupSyncedSkills`; implement identically in the client when it gains the merged view

Identity changes remain additive. Existing skill IDs and the deployed
`shaToSkillIds` contract are compatibility boundaries.
