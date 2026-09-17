# Pinned Install Metadata Contract

Crawl 4 may publish these optional install coordinates on a skill record:

- `repo_slug`: canonical GitHub `owner/repository`
- `skill_md_path`: repository-relative path to `SKILL.md`
- `repo_commit_sha`: immutable 40-character commit SHA
- `skill_tree_sha`: Git tree SHA for the package root
- `skill_md_sha`: Git blob SHA for `SKILL.md`
- `install_target_name`: safe local destination directory name

The fields are atomic. A record either omits the new pinned metadata or publishes all six fields with valid values. Existing legacy records may continue to publish `skill_md_path` and `skill_md_sha` without the four new fields during migration.

Package-root mapping:

- `SKILL.md` has package root `.` and `skill_tree_sha` is the commit root tree.
- `skills/example/SKILL.md` has package root `skills/example` and `skill_tree_sha` identifies that directory tree.

The `SKILL.md` entry inside `skill_tree_sha` must have a blob SHA equal to `skill_md_sha`. Recursive GitHub trees marked `truncated` are never treated as complete; known paths are verified through targeted tree traversal, while unresolved paths retain last-good metadata or remain legacy.

Client fallback rule:

- Use the legacy installer only when pinned metadata is absent.
- Never fall back after pinned metadata is present but its commit/tree/blob validation fails.

Compatibility fixtures for the Mac fetcher live in `fixtures/pinned-install-skills.json`.
