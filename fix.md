# App Metrics Fix Plan

## Summary

Telemetry shows two separate problems:

- App usage and new first-launch signals are very low.
- Refresh and install errors are hard to diagnose because the events lack enough context.

The main product risk is not one confirmed app-breaking bug yet. The stronger finding is that our telemetry and health checks are not good enough to quickly separate acquisition issues, download issues, launch issues, refresh issues, and install issues.

## Desired Error-State Behavior

This is the product principle for library data: stale data is better than empty data.

- Show existing cached or bundled data while refresh runs.
- A failed refresh may update telemetry and status metadata, but it must not replace valid visible data with empty arrays.
- Only show a true no-data error when cache and bundled fallback both fail.
- Cancellation is normal lifecycle behavior, not an error state.
- Crawl4/v2 fallback should count as usable data, not as a user-visible failure.

Stage 1 MVP:

- Failed refresh must not blank visible data.
- Stale data is acceptable.
- Do not add new UI unless it is needed to prevent or clarify a blank state.

User-facing behavior:

- Use subtle status text for stale data, such as "Showing cached data from Jun 29".
- Do not show modals or alerts for background refresh failures.
- Stage 2: use `ContentUnavailableView` for true no-data states when available.
- Stage 2: hide developer-only copy like "Run npm run scrape" in production builds.
- Stage 2: extract any new error/empty-state UI into a small dedicated SwiftUI view.

Data-flow requirements:

- `SkillsStore` should preserve previous successful arrays when a later reload fails.
- Replace visible skill arrays only after new data is successfully decoded.
- Stage 2: invalid cache should be removed only after bundled fallback is confirmed available.
- Stage 2: the store should expose enough state to distinguish stale usable data from no usable data.

Telemetry requirements:

- Stage 1: keep telemetry simple with `trigger`, `track`, `result`, `error_code`, and `attempt_count`.
- Stage 2: split failures into `refresh_failed_but_data_available` and `refresh_failed_no_data`.
- Stage 2: include `data_source`: `cache`, `bundle`, or `none`.
- Stage 2: include `active_track` and fallback track when relevant.

## Stage 1: Minimal Refresh Reliability Patch

Ship this first and evaluate TelemetryDeck before building broader reliability work.

1. Add version/build to app launch telemetry.
   - `app.launched` currently has no version params.
   - Add the same `app_version` and `build_number` params used by install events.

2. Add refresh retry/backoff.
   - Wrap manifest and asset downloads with retry: 3 total attempts with 1s and 2s retry delays.
   - Retry only network-like failures and transient HTTP failures.
   - Do not retry validation failures like hash or byte-count mismatch.
   - Check cancellation before each retry and before each retry sleep.
   - Log only one final `error.refresh_failed` after retries are exhausted, with `attempt_count`.
   - Do not log `CancellationError` as `error.refresh_failed`.

3. Add panel-open throttle/cooldown.
   - Current behavior refreshes on every panel open.
   - Use the existing `lastPanelOpenAttemptAt` metadata field for a short cooldown.
   - This is the main mitigation for one user creating many repeated refresh errors.
   - Skip delayed/cancellable panel refresh for Stage 1 unless it is trivial while adding the cooldown.

4. Add basic refresh telemetry.
   - Include `trigger`, `track`, `result`, `error_code`, and `attempt_count`.
   - Keep the human-readable error message, but do not rely on it as the primary grouping field.

5. Preserve visible data on failed reload.
   - `SkillsStore` should preserve previous successful arrays when a later reload fails.
   - Replace visible skill arrays only after new data is successfully decoded.
   - Do not add new error UI unless needed to avoid a blank state.

Stage 1 explicitly skips:

- `NWPathMonitor`.
- Dedicated error-state SwiftUI refactor.
- `ContentUnavailableView` migration.
- Git install retry, timeout, and cleanup.
- Install failure telemetry/UX changes.
- `/health` degradation changes.
- Manifest/release docs cleanup unless touched by this patch.

## Stage 2: Defer Unless Data Still Shows A Problem

Only build these if Stage 1 does not sufficiently improve metrics or if later data points to these areas.

- Split refresh failures into `refresh_failed_but_data_available` and `refresh_failed_no_data`.
- Add a shared network status monitor for offline filtering.
- Add full no-data UI cleanup, including `ContentUnavailableView` and production-safe copy.
- Add git install timeout/retry/partial cleanup.
- Add richer install failure telemetry and clearer install error UX.
- Fix pasted GitHub URL fallback behavior.
- Add `/health` thresholds for zero launches/installs.
- Align manifest/release docs and scripts.

## Evidence

- Last 30 days: `error.refresh_failed` had 170 events from 29 users.
- Last 7 days: `error.refresh_failed` had 98 events from 12 users.
- Top refresh errors include offline internet, timeouts, TLS/SSL failures, and vague internal `RefreshError error 2` buckets.
- `app.installed.v2` means first tracked app launch with local install flags unset. It is not a true download or DMG install metric.
- `app.launched` is sent without app version or build number.
- `download(from:)` is single-attempt with a 30 second timeout and no retry.
- Panel-open refresh currently has no throttle. The current tests explicitly assert that panel-open checks are never throttled.
- Fixing panel-open throttling will intentionally require changing those tests, not only adding new tests.
- `data.refreshed` only fires when data changes. It does not count successful no-change checks.
- Delayed panel-open refresh must be cancellable, otherwise it can fire after the panel closes.
- `SkillInstaller` runs `git clone` as a subprocess with no retry and no timeout.
- `SkillInstaller` currently uses `waitUntilExit()`, which blocks while the subprocess runs.
- `SkillInstaller` checks fixed git paths, so `missingGit` is possible but probably not the main install failure on most Macs.
- Partial repo cache after a failed clone is plausible: if `.git` exists, the next attempt skips clone and can fail later with `missingSkillFile`.
- Symlink or folder conflict is real: if the target path exists but has no `SKILL.md`, install throws `invalidInstallCommand`.
- Pasted GitHub URL fallback is a likely install failure source because it assumes repo-root skills while most skills are nested.
- Last 30 days showed real engagement from active users: hundreds of searches and skill opens, but low new first-launch volume.
- Existing health checks do not fail only because app launches or first-launch signals go to zero.

## Verification Plan

Stage 1 tests:

- `app.launched` includes `app_version` and `build_number`.
- Transient refresh failures retry, validation failures do not retry.
- Retry telemetry logs only one final failure with `attempt_count`.
- Cancelled refreshes do not log `error.refresh_failed`.
- Panel-open cooldown suppresses repeated refresh attempts.
- Existing tests that currently assert panel-open checks are never throttled are updated intentionally.
- Failed reload with existing visible data keeps UI populated.
- Delay/retry tests use awaitable hooks or injectable clocks, not fixed sleeps.

Stage 1 production check:

- Compare TelemetryDeck `error.refresh_failed` before and after release.
- Confirm launch events can be grouped by app version/build.
- Confirm app engagement signals still appear after the patch.

Stage 2 future tests:

- Failed cache decode falls back to bundled data before showing empty state.
- Failed cache and failed bundle shows true no-data state.
- Stale status appears when showing cached or bundled data.
- Delayed panel-open refresh is cancelled when the panel closes or a newer refresh supersedes it.
- Repeated panel opens do not queue multiple delayed refresh tasks.
- Network context can be attached without creating one monitor per refresh.
- Git clone timeout terminates the process and partial repo cleanup is safe.
- Install telemetry includes `install_error`, `install_flow`, `target`, and `repo_url`.
- GitHub URL fallback handles missing root `SKILL.md`.

## Open Questions

- What threshold should mark app launch/install health as degraded: 24 hours, 48 hours, or a rolling comparison against recent baseline?
- Should refresh errors from clearly offline users be reported as degraded, or tracked separately as expected client network noise?
- Should unknown GitHub repos be installable only after a live root `SKILL.md` check, or should the app block them until they are indexed?
- Should the marketing funnel health page show raw zero-count warnings, trend-based warnings, or both?
