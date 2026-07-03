# skills.sh Coverage Audit — 2026-07-03

Audit of our library (50,869 skills) against skills.sh's all-time leaderboard and official page.

## Scale facts

- skills.sh ranked all-time list: **9,631 skills total** (the 800K+ figure is installs, not skills)
- rank 2,000 sits at ~3,748 installs
- official page: **472 repos, 5,363 skills**
- our crawler already has working sources for both (`sources/skillssh.ts`, `sources/official.ts`)

## All-time top 2,000: 78.2% exact coverage

| Rank band | Exact skill-ID match |
|---|---|
| 1–500 | **65.2%** (worst) |
| 501–1,000 | 85.4% |
| 1,001–2,000 | 81.1% |

The head is weakest because that's where viral low-star repos concentrate — and our gates are star-only.

### Failure mode 1 — unknown repos (134 entries, 63 unique repos)

Dominated by viral, low-star repos blocked twice: the skills.sh source filter (`minRepoStars: 50` in `skillssh.ts`) and the 500-star admission gate.

| Repo | Top skill installs | Skills in top 2K | Stars |
|---|---|---|---|
| doany-ai/skills | 230,735 | 2 | 5 |
| scrapegraphai/just-scrape | 220,480 | 1 | 31 |
| agentspace-so/skills | 211,715 | 1 | 11 |
| vyralcontent/content-skills | 113,362 | 7 | 48 |
| sentry/dev | 96,624 | 1 | — |
| nozomio-labs/nia-skill | 48,070 | 1 | — |
| momentic-ai/skills | 28,965 | 3 | — |

**Core finding: installs and stars are orthogonal value signals. Star-only gates make high-velocity content structurally invisible.**

Caveats in this bucket:
- `sickn33/antigravity-awesome-skills` (9 entries) is a **deliberate policy exclusion** — correct absence
- `open.feishu.cn`, `agent.qq.com`, `skills.volces.com` (4 entries) are non-GitHub sources — unrepresentable in the current model, known limitation

### Failure mode 2 — partial repos (302 entries, 78 repos)

Repo is in our library, specific skills are not. Verified real (not naming mismatches):

| Repo | Top missing skill installs | Missing in top 2K |
|---|---|---|
| leonxlnx/taste-skill | 211,109 | 8 |
| microsoft/azure-skills | 208,150 | 5 |
| obra/superpowers | 168,337 (`using-superpowers`, #23 all-time) | 1 |
| mattpocock/skills | 158,164 | 20 |
| coreyhaines31/marketingskills | 141,854 | 36 |
| pbakaus/impeccable | 86,328 | 23 |
| firebase/agent-skills | 97,694 | 14 |
| heygen-com/hyperframes | 61,765 | 18 |
| anthropics/skills | 62,724 | 2 |

`obra/superpowers:using-superpowers` exists in the library only as third-party repackages — the original is missing while its repo siblings are present. This is an enumeration/refresh gap inside already-admitted repos, **not** an admission problem. Needs separate root-cause investigation.

## Official page: 65% exact coverage, 100 repos fully unknown

Top unknown official repos by installs:

| Repo | Installs | Skills | Stars |
|---|---|---|---|
| parallel-web/parallel-agent-skills | 67,241 | 10 | 57 |
| vercel/next.js | 10,851 | 19 | 140,318 |
| upstash/context7 | 7,554 | 7 | — |
| getsentry/sentry-agent-skills | 6,620 | 23 | 19 |
| anthropics/claude-for-legal | 4,754 | 118 | 8,604 |
| streamlit/streamlit | 1,173 | 19 | — |
| getsentry/sentry-for-claude | 1,043 | 34 | — |
| cloudflare/cloudflare-docs | 975 | 18 | — |
| stripe/agent-toolkit | 564 | 3 | — |
| pinecone-io/skills | 734 | 15 | — |

`anthropics/claude-for-legal` (8.6K stars) and `vercel/next.js` (140K stars) pass every existing gate — these are not gate failures. Official-page repos are discovered every run (fast lane), and the value gate accepts `sources.has("official")`. The bottleneck is bootstrap throughput: the June 24 local shadow run bootstrapped 15 repos in one pass. Admission is operational but gradual, and the official page is growing faster than per-run bootstrap absorbs.

Plus: Crawl 4's skills.sh crawl samples only the top 500 (`topLimit: 500` in `build-shadow.ts`); legacy v2 used `crawlAll: true`.

## Recommendations

1. **Bounded backfill trial** (below) — already spec'd as a pending decision in `crawl4-task.md`; this audit provides the candidate list
2. **Install-based value gate** — skills.sh installs ≥ ~4K (top-2K level) qualifies for admission regardless of stars; requires relaxing `minRepoStars` for the skills.sh source so viral repos are discovered at all. Behavior change → own shadow validation, after the trial
3. **Deepen skills.sh crawl** — `topLimit: 500 → 2000+` (full ranked list is 49 pages)
4. **Auto-refresh official coverage** — measure official-page coverage in shadow reporting (missing-official count) so this gap is visible per run instead of audited ad hoc
5. **Root-cause partial-repo gaps** — why known repos are missing their highest-installed skills; likely path enumeration or refresh, separate from admission

## Bounded backfill trial plan

Constraints (per `crawl4-task.md`): existing v1 admission policy, cap ~50, inspect everything, no production publish until quality review passes.

Mechanism notes (verified in code):
- `index/seeds/manual-include-repos.json` affects the **admission value gate only** (`admission.ts`) — it does not force discovery. Only discovered repos can be admitted.
- Official-page repos are discovered every run via the fast lane → manual include works for them without code changes.
- Viral low-star repos are filtered at the source (`minRepoStars: 50`) → never discovered → manual include alone cannot admit them. They wait for recommendation 2.
- `scrape:shadow` writes only to `index/shadow/*`. Publishing is a separate explicit step. Local runs cannot touch production.

### Steps

1. **Baseline run** — fresh local `npm run scrape:shadow` (combined), no seed changes. Observe natural discovery/admission/bootstrap of the missing official repos. Record: bootstrapped / failed / skipped counts and samples.
2. **Review baseline** — which audit candidates were admitted naturally; verify no catalog-like leaks (`sickn33` et al. stay excluded).
3. **Manual include the gap** — add remaining high-value official repos (from the table above) to `manual-include-repos.json`, bounded ≤ 30. No viral low-star repos in this trial (they need recommendation 2 first).
4. **Second run** — `npm run scrape:shadow` again; confirm manual-include admissions bootstrap cleanly.
5. **Quality inspection** — review every newly admitted skill in the shadow output; run `npm run test:shadow-guard`; check steady-state criteria.
6. **Persistence check** — one more combined run; confirm admissions persist.
7. **Only then** decide on publishing and on repeating a second bounded batch.

### Trial log

- [x] Baseline run — 2026-07-03, exit 0, cutover validation passed
- [x] Baseline review — see root cause below
- [ ] ~~Manual include batch~~ — not needed; see root cause
- [x] Second run (with bootstrap fix) — first attempt crashed on a deleted repo (`anthropics/claude-skills`, stale official-page entry); hardened resolution to treat lookup failures as skip-not-crash, added regression test; rerun succeeded
- [x] Quality inspection — see results below
- [x] Persistence check — follow-up combined run: 15/15 probed admissions persisted, cutover stable at 50,957, no re-bootstrap (correct), exit 0
- [x] Publish decision — approved 2026-07-03; fix committed (`124ba78`) and pushed; `shadow-crawl-health` dispatched and succeeded; live `/data/crawl4` updated (51,073 skills)

### Publish outcome (2026-07-03)

The dispatched CI run published successfully but admitted only part of the trial set (e.g. `emilkowalski/skills` live; `anthropics/claude-for-legal` not yet). Root cause: the CI crawl hit GitHub API 403 rate limits during bootstrap path resolution (quota consumed by the day's local trial runs), and resolution failures are treated as skip-not-crash. **Self-healing**: bootstrap retries every combined run; the next scheduled runs (06:00 / 12:00 UTC daily) have fresh quota and will admit the remainder. Verify by checking live crawl4 data for `anthropics/claude-for-legal` after the next scheduled run.

### Follow-ups

- The 37 `repo-mismatch` candidates retry (and fail) every combined run. Harmless but wasteful; a quarantine similar to repo-missing churn handling could stop the repeat work.
- Candidate path resolution currently treats 403 (rate limit) the same as 404 (dead repo) — both skip. Distinguishing them (defer on 403, skip on 404) would avoid losing admissions to quota exhaustion, though bootstrap's per-run retry makes this self-correcting.
- Forks of excluded catalog repos evade provenance (marked `original`, no `upstream_repo`) — fork detection would catch repackager forks.

### Fixed-run results (2026-07-03)

Two crawler changes shipped (both in `scraper/new-crawl/bootstrap.ts`, tests in `bootstrap.test.ts`, 197 shadow-guard tests green):

1. `official`-source candidates now get path resolution before the eligibility check (previously only `skillssh`/`awesome` did)
2. Candidate path resolution failures (deleted/renamed repos) skip the candidate instead of failing the whole crawl

Bootstrap results: **29 bootstrapped** (was 4), 37 failed `repo-mismatch` (cleaned up, 0 empty admitted repos), 55 skipped `no-eligible-candidate` (mostly dead/junk official-page entries — e.g. `cloudflare/com`, `anthropics/claude-skills`).

Admitted official repos include: `anthropics/claude-for-legal`, `getsentry/sdk-skills`, `getsentry/sentry-for-cursor`, `getsentry/april-log-summarizer`, `contentstack` ×2, `clickhouse`, `firecrawl/openai-skills`, `parallel-web`, `pinecone-io/skills`, `langchain-ai/lca-skills`, `launchdarkly`, `neondatabase`, `planetscale`, `semgrep`, `temporalio`, `runwayml`, `sanity-io`, `mcp-use`, `emilkowalski/skills`, `github/spec-kit`, `microsoft/win-dev-skills`.

Quality inspection: cutover output +88 vs production (includes prior shadow deltas). New admissions are overwhelmingly head-quality official/vendor content. Catalog-leak check: 0 `sickn33/` entries; 14 `antigravity-awesome` matches are third-party forks already present identically in production (pre-existing, not from this run) — noted as a provenance follow-up (forks of a known repackager marked `original` with no `upstream_repo`).

Steady-state acceptance: **pass, exit 0** — cheap checks 1488/1488 (0.0% variance), cheap-triggered refresh 9.3%, runRefresh 8.9m, empty admitted repos 0.

Bootstrap admits one proven skill per repo; full repo skill sets (e.g. claude-for-legal's 118) expand through subsequent refresh cycles.

### Provenance follow-up (new, low priority)

Forks of excluded catalog repos (e.g. `benjaminasterA/antigravity-awesome-skills`, 4 more) carry `provenance_type: original` with no `upstream_repo`. Fork-detection in provenance would catch repackager forks that the name-based exclusion misses. Pre-existing library content, not a regression.

### Root cause found during baseline (2026-07-03)

Baseline results: bootstrapped 4 (all `awesome` source), failed 3 (`repo-mismatch`), **skipped 118 — every one with reason `no-eligible-candidate`**, including `anthropics/claude-for-legal` and the other audit targets.

The bug: `isBootstrapEligibleCandidate` (`bootstrap.ts`) requires `official` candidates to have a resolved `skill_md_path`, but `official.ts` always emits `__RESOLVE__` — and the resolution step in `bootstrapRisingRepos` only attempted resolution for `skillssh` and `awesome` sources, never `official`. Official candidates were permanently ineligible: discovered every run, passing the value gate, then dead-ending at bootstrap. This single bug explains the official coverage gap; manual include would not have helped (these repos already pass the value gate).

The fix: include `official` in the path-resolution branch (one line in `bootstrap.ts`), keeping the unresolved-ineligible safety net intact. Covered by a new test mirroring the existing skillssh resolution test. All 196 shadow-guard tests pass.
