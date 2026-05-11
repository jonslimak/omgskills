# Security

omgskills is source-available so users can inspect what the app does before
running it.

## What the app does

- Reads public skill index data bundled with the app or downloaded from
  `omgskills.com`.
- Scans local Claude, Codex, and agent skill folders to show installed skills.
- Installs skills from public GitHub repositories when the user chooses to do so.
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
