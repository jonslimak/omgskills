# Finding: deploy verification fails on one-off "fetch failed" errors

Written 2026-10-29 from read-only checks of main `070861fc` and recent runs.
No code was changed. For whoever owns the deploy pipeline.

## Symptom

Four runs in two days failed at deploy verification with `fetch failed`,
while manual live checks afterwards passed every time:

- shadow-crawl-health 40895482652 (2026-10-29 14:50): draft verification
  failed, production not changed. Its data commit `f20fae9e` landed anyway
  and was deployed later.
- deploy-current-main 40903858874 (15:39): production was published, then
  all four verification attempts failed. Issue #227 was closed after
  independent live checks passed.
- pipeline-health 40828023073 (06:14): draft verification failed on every
  attempt, production not changed.
- deploy-current-main 40790012846 (Oct 28 23:49): attempt 1 failed, then
  passed on retry.

## Cause

`scripts/deploy-netlify-production.mjs` runs each verification attempt as
the full sequence: `verify-production-deploy.mjs`, then
`verify-web-library-pages.mjs --live`, then three `verify-live-manifest.mjs`
checks. A single error anywhere fails the whole attempt, and the next
attempt reruns everything after a fixed delay (draft: 3 attempts, 10 s
apart; production: 5 attempts, 15 s apart).

- `verify-web-library-pages.mjs` already retries each request (3 tries,
  15 s timeout, 0.5 s and 1 s backoff), so it only fails when a page is
  unreachable three times in a row.
- `verify-production-deploy.mjs` does not retry. `expectStatus` makes one
  `fetch` with a 20 s timeout, and any network error ends the run.
- Its error text is Node's bare `fetch failed`: no URL and no cause
  (`ECONNRESET`, DNS, TLS, timeout). The logs can't show which endpoint
  failed or why, which is why #227 recorded the failure as "not reproduced
  or definitively diagnosed".

Each attempt makes many requests (manifests, MCP, functions, Set routes,
appcast, downloads), and the web-library pass adds thousands more. With no
per-request retry in the first script, one transient connection error from
a GitHub runner is enough to fail an attempt. The fixed delays mean a
burst lasting a minute or so fails every attempt.

## Suggested fix (not applied)

1. In `verify-production-deploy.mjs`, retry network errors and 5xx per
   request, matching `fetchLive` in `verify-web-library-pages.mjs` (3 tries,
   backoff). Keep failing immediately on wrong 2xx/3xx/4xx statuses, since
   those are real defects.
2. Include the URL and `error.cause` (code and message) in every fetch error
   in both scripts, so a failure names its endpoint and reason.
3. Optionally give whole-attempt retries growing delays (for example 15 s,
   30 s, 60 s) instead of fixed ones.

None of this relaxes what is checked. A missing or wrong asset still fails.

## Unrelated doc drift

`deploy.md` says not to run `verify-web-library-pages.mjs --live` against
the draft hostname, because generated links use `omgskills.com`. The deploy
script now does exactly that on purpose, passing
`PUBLIC_ORIGIN=https://omgskills.com` so canonical checks use the public
origin. The doc line should be updated to match.
