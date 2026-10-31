# Frontmatter Parser

Prepared on 2026-10-30 from main `79caf048`. This follows
`../hide-invalid-frontmatter-20261030` (#254). That change hid 234 of the 237
skills that the crawler had rejected with `missing-frontmatter`.

## Parser change

`scraper/frontmatter.ts` now reads frontmatter the way agents do:

- It ignores a byte-order mark, Windows line endings and blank lines before
  `---`.
- Strict YAML is tried first. If it fails (unquoted colons, an apostrophe in a
  single-quoted value, an unclosed block), the parser reads only the top-level
  `name:` and `description:` lines.
- With a description but no `name`, the skill takes its folder's name.

Every file that parsed before parses to the same name, description and tags.
A file with no frontmatter block still fails.

## Re-check of the 237

Each skill was re-read with `enrichCandidate` from its current default branch
(`results.json`):

- Restored: 74. They now pass, and their resolved file is the expected
  `SKILL.md`. The name matches the catalog's name or the ID's folder. Their
  `source-invalid-frontmatter` suppressions are removed.
- Already live: 3. #254 held them, and they now pass too.
- Still hidden: 160.
  - No frontmatter block: 105.
  - The crawler reads a different file, usually a linked folder: 36.
  - The parser passed, but path resolution picked another skill's file: 8.
  - `version: 1.0.0description:` on one line: 4.
  - Stored path not found: 7.

The main cause was a byte-order mark, followed by unquoted colons in
descriptions.

## Timing

A crawl drops suppressed skills from its records. If a crawl applies #254
before this merges, the 74 may not return on their own. Merge this before the
next shadow crawl.

## Checks

Strict policy validation reports 0 findings. Tests: 582 shadow-guard
(including `scraper/frontmatter.test.ts`) and 13 `scraper/enrich-cache.test.ts`.
