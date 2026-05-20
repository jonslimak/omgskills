# Changelog

All notable changes to omgskills are documented here.

## [Unreleased]

### Scraper
- Add negative cache with configurable TTLs to skip recently-rejected candidates
- Add minimum star floor to filter low-signal repos

## [0.0.13] - 2026-05-19

### Scraper
- Improve official skill path alias resolution for multi-path skill repos
- Temporarily exclude known-bad repo from scrape candidates
- Add fast debug mode and targeted enrichment debugging for scraper development

### Ops
- Add operator health dashboard with funnel metrics (sessions, downloads, installs)
- Protect health page with basic auth
- Add CSV-based funnel report for X Ads campaigns
- Fix homepage leaderboard data refresh
- Fix pipeline health workflow sequencing and live manifest verification

## [0.0.12] - 2026-05-13

### App
- Add share tracking for skill installs

### Website
- Ship homepage data leaderboard section
- Add ban808 banner video
- Widen homepage content layout
- Use direct DMG download links
- Label download CTA clicks for analytics
- Update footer links and legal pages

### Ops
- Guard production site deploys against uncommitted changes

## [0.0.11] - 2026-05-12

### App
- Ship TelemetryDeck analytics diagnostics

## Earlier releases

Versions 0.0.1 through 0.0.10 predate this changelog.

[Unreleased]: https://github.com/jonslimak/omgskills/compare/v0.0.13...HEAD
[0.0.13]: https://github.com/jonslimak/omgskills/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/jonslimak/omgskills/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/jonslimak/omgskills/releases/tag/v0.0.11
