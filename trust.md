# Trust & Safety Signal

How omgskills adds a trust layer to the library — borrowed scanning plus two
signals only we can produce. Research + strategy captured 2026-07-07; see
`crawl-audit.md` Phase 3.5 for where this slots into the larger plan.

## How the market does it (research summary)

**skills.sh does not scan anything itself.** It partners with three vendors —
Snyk, Socket, Gen — who scan server-side when skills flow through the
`npx skills` CLI. The CLI is display-only and fail-open: audit fetch has a 3s
timeout, never blocks an install, `--yes` skips even the warning. Enforcement
(hiding, warning pages) lives on the website.

**All serious scanners are hybrid**, not "just an LLM":

- static analysis: code patterns, suspicious URLs, env-var access, shell analysis
- LLM judges: prompt-injection detection, description-vs-actual-behavior checks

Neither layer alone works — regex misses novel phrasings; LLM review is
structurally blind to e.g. Claude Code `!`-prefixed frontmatter commands that
execute before the model reads anything.

**Known weak spots of the current scanners:**

1. install-time social engineering ("download this password-protected zip" —
   the ClawHavoc campaign, ~1,200 malicious skills, evaded AV screening)
2. post-scan mutation — skills are git refs and can turn malicious after a
   "Pass"; only Socket claims continuous rescanning
3. repackaging — a byte-identical copy of a trusted skill under an unknown
   account scans identically clean
4. coverage — vendors only scan what flows through skills.sh's CLI, and they
   disagree in the wild (Vercel's own `find-skills`: Pass, Pass, Warn, and
   "High Risk" from a fourth vendor)

**Key fact:** Snyk's scanning engine is open source —
[`snyk/agent-scan`](https://github.com/snyk/agent-scan) (ex-Invariant
mcp-scan), runnable locally (`uvx snyk-agent-scan@latest --skills`). Issue
codes: E004 prompt injection, E006 malware payloads, W007/W008 credential
handling, TF001 toxic flows.

## Strategy: don't build a me-too scanner

Replicating an LLM judge adds nothing — Snyk/Socket have the datasets, threat
intel, and teams. The differentiated position for a curator is:

> **borrowed scanner + freshness (ours) + provenance (ours)**

### 1. Borrowed scanning over curated tiers

- weekly job runs `snyk/agent-scan` over the curated head: gold basket +
  featured/watched-creator skills (a few thousand rows, not 50k)
- results stored as a trust flag per skill — **advisory, not an admission gate**
  at first
- covers skills that skills.sh never scanned (their coverage is CLI-driven;
  ours is library-driven)

### 2. Freshness / change detection — our unfair advantage

- the crawler already tracks `skill_md_sha` per crawl and publishes the
  append-only sha history index (identity MVP, shipped)
- rule: **content changed since last scan → re-scan; changed after being
  featured → flag for review**
- this closes the post-scan-mutation gap that almost nobody ships, and for us
  it is nearly free — the diffing infrastructure already exists

### 3. Provenance — an identity check scanners can't do

- canonical attribution + the creator registry catch the repackaging vector:
  "byte-identical copy of a trusted creator's skill, republished by an unknown
  account" — content scanners see identical clean content on both copies
- this is a trust signal derived from identity, not content; it falls out of
  the dedup/canonical work already planned (`audit-task.md` T3.2–T3.4)

### 4. Cheap static rules for the known gaps

A small pattern set targeting exactly the classes the big scanners missed:

- `!`-prefixed commands in skill frontmatter (pre-execution, bypasses LLM review)
- "prerequisites" instructing downloads of archives/binaries, especially
  password-protected (ClawHavoc pattern)
- `curl | sh` / encoded droppers in bundled helper scripts

## Presentation

- trust flags surface on curated tiers first (editorial profiles, gold basket,
  web library pages) — where we make implicit endorsements and therefore carry
  implicit responsibility
- states: `scanned-clean` / `flagged` / `changed-since-scan` / `not-scanned`
- honest by default: most of the long tail stays `not-scanned`; never imply
  coverage we don't have
- a `flagged` result on a curated skill blocks featuring until reviewed
  (operator decision via editool, not automatic delisting)

## Sequencing

1. after tiers exist (`audit-task.md` T3.6) — scanning the curated head needs
   the head defined
2. static-rule set (item 4) can ship earlier — it's crawler-side and cheap
3. change-detection flag (item 2) once scan results exist to diff against
4. provenance signal (item 3) arrives with canonical attribution automatically

## Non-goals

- scanning all 50k skills with LLM judges (cost without differentiation)
- hard install blocking (we're a directory, not a gatekeeper — match the
  market's advisory posture)
- building or training our own detection models
- claiming "verified safe" — the strongest honest claim is "scanned + fresh +
  attributed"
