# Security

omgskills is source-available so users can inspect what the app does before
running it.

## What the app does

- Reads public skill index data bundled with the app or downloaded from
  `omgskills.com`.
- Scans local Claude, Codex, and agent skill folders to show installed skills.
- Installs skills from public GitHub repositories when the user chooses to do so.
- Connects to the user's omgskills account when the user chooses to, and reports
  installed skills (names, metadata and fingerprints, not full local paths).
- With Sync My skills on, uploads skill files to the user's private My skills.
  Files that look like they contain a key or password are held back until the
  user confirms them.
- Installs Sets the user has access to, including private skills shared with them.
- Uses Apple's Developer ID signing and notarization flow for public releases.

## What should not be public

The repo should not publish local crawl files, browser logs, cookies, `.env`
files, signing certificates, API tokens, or release credentials.

## Reporting a security issue

Please report suspected security issues privately by opening a GitHub security
advisory or contacting the maintainer directly.

Do not include live secrets, private tokens, or personal data in public issues.

## Public issues

For normal bugs, feature requests, and documentation issues, public GitHub
issues are fine.
