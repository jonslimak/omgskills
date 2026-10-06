# Standalone package preview and isolated install (H1.1/H1.2)

Local experiment only. No real skill-root writes, private auth, or public-app dependency.
The same isolated H0 bundle and `omgskills-helper-test` scheme now support a real
pinned package preview. Links accept only the two fixture IDs; the helper resolves
their pins through the public OMGSkills MCP endpoint and downloads from GitHub
over HTTPS. It verifies tree/blob hashes and validates paths and package limits
before staging. It never writes to a real agent's skill directory or executes content.
Without an explicit test-root launch setting it remains preview-only. H1.2 enables
install/update/rollback only inside a generated temporary sandbox.

```sh
swift test --package-path experiments/browser-handoff --build-path /private/tmp/omgskills-h1-build
```

Tests are offline by default. Explicit public-network check:

```sh
OMGSKILLS_H1_LIVE_TEST=1 swift test --package-path experiments/browser-handoff --build-path /private/tmp/omgskills-h1-build --filter livePublicPreview
```

Quit the existing test helper before building its replacement:

```sh
sh experiments/browser-handoff/build-local.sh
python3 -m http.server 65439 --bind 127.0.0.1 --directory experiments/browser-handoff
```

Open the generated `.test-app/OMGSkills Handoff Test.app` once to register its
test-only URL scheme. Open `http://127.0.0.1:65439/test-page.html` in a browser.
The pinned link should show a verified file list. The unpinned example should
refuse unless the catalog later gains a valid pin. Cancel clears the preview.
Stop the test app and server after testing. No browser timeout implies success.

The build is ad-hoc signed, not a distributable notarized helper. The source
symlink `Sources/HandoffCore/SkillPackageValidator.swift` deliberately compiles
the unchanged Mac validator in this separate target. Preserve it as a relative
symlink; do not replace it with a second copy. GitHub commit/tree/blob HTTPS
retrieval does not require `/usr/bin/git` or command-line developer tools.

H1.1 preview staging is temporary and non-executable. Files are removed before
success is displayed. A force-kill during staging may leave a directory named
`omgskills-h1-preview-<UUID>` under the current user's temporary directory;
it is never an installed skill and must not be treated as a trusted resume point.

## H1.2 safety contract

The helper owns a generated `omgskills-h12-<UUID>` directory and marker inside
the canonical system temp directory. Browser URLs never select paths. Inside
that sandbox, `codex/skills/frontend-design` is a link to a complete version
under `.managed/versions/<UUID>/content`, with a sibling `record.json`.
Records include source pins, file hashes/sizes/modes, ownership and the previous
version. Existing unmanaged installs are refused, not migrated.

Review freezes the candidate and installed baseline. Apply rechecks all files,
permissions and the record under a cross-process lock, rereads staged files,
then atomically switches the owned link. Restore has its own review and checks.
No network or async suspension occurs in the write transaction. Cancellation
before publication leaves the old version; after publication the helper reports
the installed result. The active link is authoritative on restart.

Diffs use Swift's standard collection difference on byte-exact lines, keeping
final-newline metadata separate from file content. Unicode-equivalent text
with different bytes still appears as a change. Limits are 64 KiB/file,
2,000 lines per side and 128 KiB total changed input. Binary/unsupported text or larger
reviews fail closed. There is no truncated-diff approval or force overwrite.
Staged versions and previous versions are retained in the disposable sandbox;
this slice has no garbage collector and makes no power-loss durability claim.
Owned/no-follow descriptors protect against unexpected paths, not malicious
software already running with the same user's permissions.

## Controlled manual test

These are developer setup commands; the human test itself uses browser buttons
and helper controls. Stop any existing test helper first. Do not run `open -n`,
launch a second copy, change the public URL scheme, or touch the public Mac app.

```sh
sh experiments/browser-handoff/build-local.sh
HARNESS="${TMPDIR:-/private/tmp}/omgskills-h0-handoff/swift-build/release/HandoffInstallHarness"
ROOT=$("$HARNESS" create)
"$HARNESS" select "$ROOT" A
open -a "$PWD/experiments/browser-handoff/.test-app/OMGSkills Handoff Test.app" \
  --env "OMGSKILLS_H1_INSTALL_ROOT=$ROOT" --env OMGSKILLS_H12_FIXTURES=1
```

Use the existing local test page's pinned link. Confirm **Local fixtures** and
the temporary destination. Install A; reopen for **Already installed**. Change
the fixture locally with `"$HARNESS" select "$ROOT" B`, reopen the same link,
review added/removed/changed files and the mode change, cancel, then reopen and
apply. **Review previous version** offers rollback. No synthetic SHA is presented
as a real published release. This test app is not the production helper.

For public delivery, use a separate fresh root and omit `OMGSKILLS_H12_FIXTURES`.
An isolated automated public check is also available:

```sh
OMGSKILLS_H12_LIVE_TEST=1 swift test --package-path experiments/browser-handoff --build-path /private/tmp/omgskills-h12-build --filter livePublicInstallInSandbox
```

The offline suite launches `HandoffInstallHarness` subprocesses and kills only
those children before/after activation. It checks fresh-process recovery, retry,
rollback and lock exclusion. The harness locates itself beside the SwiftPM test
bundle and is not copied into the test app. Temporary test roots are removed by
tests; manual roots and crash remnants must be accounted for after a session.
