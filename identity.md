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

### 3. Content-hash match — exact, version-pinned

Hash the local `SKILL.md` the same way the crawler computes `skill_md_sha`. Look it up in the cached catalog.

Match → resolved, with the exact version identified.

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

## Proposed system addition: sha history index

The one new piece worth building.

The crawler observes every skill version it crawls but only remembers the latest sha. Keep an append-only mapping instead:

```
sha → skill id
```

Published as a small manifest asset alongside the existing data.

Properties:

- a few bytes per version — an index, not a mirror; does not make us a content host
- append-only — shas are never removed while the skill exists
- makes resolution version-proof: any `SKILL.md` the crawler has ever seen resolves, no matter how stale the local copy
- client-side lookup against published data, same as everything else

## Design properties

- **Resolution is entirely client-side** against data we already publish. The server never sees skill content. We stay a catalog, not a host.
- **It degrades honestly.** Exact → confirmed → local. A resolution-confidence field extends the existing `author_confidence` pattern naturally.
- **It composes with every surface.** A resolved skill gains a catalog ID, which is all that groups, editorial, and the web library need.

## Cross-agent identity: the same skill in Claude and Codex formats

Claude and Codex skills use slightly different formats. Ported skills are not word-for-word replicas, so content hashing alone will never link them. This is a third identity layer:

- **File identity** — `skill_md_sha` (exact content)
- **Catalog identity** — skill ID (a specific file at a specific URL)
- **Logical identity** — the skill as a concept, spanning its Claude and Codex ports

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

Discussion-stage. When we decide to build, the natural order:

1. **Verify hash compatibility** — confirm the client can compute `skill_md_sha` identically to the crawler (same normalization, same algorithm)
2. **Ship the ladder in the client scanner** — steps 1–3 first (all exact, no UX needed); measure what share of installed skills resolve
3. **Add the sha history index to Crawl 4 publishing** — small manifest asset, append-only
4. **Add the confirm-once fuzzy UX** — only after measuring how much steps 1–3 leave unresolved
5. **Propagate resolution into synced_skills** — resolved IDs flow into `catalog_skill_id` on sync, making groups catalog-aware for previously unresolvable skills
6. **Add cross-agent equivalence clusters to Crawl 4 publishing** — shadow-first like every other Crawl 4 change; validate cluster quality in shadow reports before clients consume it
7. **Extract the local-match heuristic into a shared spec** — document normalization, thresholds, and gate order from `groupSyncedSkills`; implement identically in the client when it gains the merged view

No code changes until this is explicitly picked up.
