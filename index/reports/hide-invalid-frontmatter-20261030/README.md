# Hide Invalid Frontmatter

Suppresses 234 skills whose `SKILL.md` has no `name` or `description` that the
crawler's frontmatter parser accepts, prepared on 2026-10-30 from main
`5642b9ac`. This commit changes `seeds/suppressed-skills.json` only; the next
shadow-crawl run drops the skills from both tracks. 234 removals are under the
500 publication-impact threshold, so no override is needed.

They are the 237 invalid-frontmatter skills left in
`../review-lists-20261030/remaining.json`, re-read on 2026-10-30. Three are
held because creator pages or collections feature them, and strict policy
validation blocks them: `bmad-code-org/bmad-method:bmad-retrospective`,
`testdino-hq/playwright-skill` and `thedotmack/claude-mem:mem-search`.

The reason is `source-invalid-frontmatter`. This is a stopgap. A sample of
seven readable files found five with a name and description that agents would
likely load, for example a description with an unquoted colon. The parser is
stricter than the agents. The follow-up is to make the parser lenient, re-read
these skills, and remove the suppressions for those that pass
(`suppressed.json` lists them).

Strict policy validation reports 0 findings.
