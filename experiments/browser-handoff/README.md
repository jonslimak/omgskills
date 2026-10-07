# Standalone helper experiment (H1.1-H1.4A)

Local experiment only. No private auth or public-app dependency.
The same isolated H0 bundle and `omgskills-helper-test` scheme now support a real
pinned package preview. Normal links accept only the two public fixture IDs; the helper resolves
their pins through the public OMGSkills MCP endpoint and downloads from GitHub
over HTTPS. It verifies tree/blob hashes and validates paths and package limits
before staging. It never executes skill content. The test app remains preview-only
without an explicit launch setting. H1.2 installs inside a temporary sandbox;
H1.3 adds permanent destination handling. Simulated-home checks passed for both
agents; the separate local Codex discovery fixture passed install/update/rollback.
Do not enable real-home mode without separate approval.

## H1.4A normal helper candidate

The separate `OMGSkillsHelper` product uses `OMGSkills Helper.app`, bundle ID
`com.omgskills.helper` and only the `omgskills-helper` scheme. It does not use
the existing menu-bar app or its `omgskills` scheme. This is a local candidate,
not a signed distribution or a public release.

- Normal launch needs no developer settings. Idle launch and agent selection
  create no store or network request; a valid public link starts lazy service
  creation. The OS account home and fixed service origins remain authoritative.
- `HandoffTestSupport` owns fixture bytes, discovery policy, launch-env parsing
  and harness commands. Only the test app/harness depend on it. Both apps share
  `HandoffCore` and `HandoffUI`; records and transactions are unchanged.
- The normal app rejects test schemes/fixture IDs and developer URL options.
  It retains the two-public-ID allowlist and `frontend-design` destination.
  The URL identifies a skill, not an exact page version; that binding is H2.
- Duplicate-copy checks guard launch, requests and approval. Busy links show a
  retry notice rather than replacing or queueing a transaction. The limited local
  launch/Safari/repeated-link/refusal/Close check passed on 2026-10-07 with installed
  skills unchanged. Cold URL launch and a ready-review/cancel check remain unverified;
  existing Frontend Design installs were protected, not replaced for the test.

Build and inspect only (requires the repo's Swift and Node tools):

```sh
node --test experiments/browser-handoff/verify-candidate.test.mjs
sh experiments/browser-handoff/build-candidate.sh
```

The command refuses a running normal helper, uses fresh build/output directories,
and prints the exact ignored `.candidate-app/candidate.*/OMGSkills Helper.app`
path. It verifies the product graph, link inputs, plist, ad-hoc signature, bundle
inventory, system-only dependencies and native architecture. Symbol/string scans
supplement those structural checks. No launch, registration, installation,
Developer ID signing, notarization, upload or release occurs. The old `.test-app`
bundle is not replaced. Failed/older outputs remain local; no automatic deletion.

Do not open the candidate as part of build verification. See
`../../webwork-h14-spec.md` for results and the separately approved manual check.
Sparkle belongs to H1.4B; signed artifacts and distribution remain H1.4C/D.

## Existing test app

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

## H1.3 destinations

The same installer supports an independent private store at
`~/Library/Application Support/OMGSkills Helper`, with a stable owner marker
and separate `codex/versions` and `claude/versions` directories. The selected
agent's skill entry is an atomic symlink to verified version content. Records
bind the store ID and exact destination, pins, hashes, modes and previous version.
No existing-app store or `.omgskills` metadata is adopted or modified.

- Codex uses `~/.agents/skills/frontend-design`. This is a shared user skills
  location, not exclusive to Codex. A same-name legacy `.codex/skills` entry blocks
  installation; the helper never writes both locations.
- Claude Code uses `~/.claude/skills/frontend-design`.
- This slice keeps the two public ID allowlist and one target name. Existing
  directories, foreign/broken links, local edits and copied foreign records
  fail closed. No existing installation is migrated or overwritten.
- Normal user-owned 0755 home/agent/support parents are accepted unchanged;
  group/other-writable or symlinked parents are refused. Private store directories
  remain 0700. No privilege escalation, chmod repair or arbitrary-root chooser.
- Changing agent discards consent and reloads that destination. Apply freezes
  selection. Parent inode identity and legacy conflicts are checked again at
  activation; the same store lock excludes other helper processes across agents.
- Removed activation links are not automatically restored. Old versions and
  interrupted staging remain retained; there is no garbage collection yet.
- These defaults do not cover custom agent roots, cloud/Cowork, plugin installs
  or project-level precedence. Local Codex discovery/supporting-file reads passed
  in fresh chats; actual Claude Code discovery and same-chat refresh remain untested.

Test-app launch modes are mutually exclusive (not available in the normal helper):

| Setting | Behavior |
| --- | --- |
| None | Preview only; no permanent store. |
| `OMGSKILLS_H1_INSTALL_ROOT=<marked sandbox>` | Existing H1.2 isolated destination. |
| `OMGSKILLS_H13_TEST_HOME_ROOT=<marked sandbox>` | H1.3 layout below `<sandbox>/home`; local agent selector enabled. |
| `OMGSKILLS_H13_REAL_INSTALLS=1` | OS account home, public downloads only. Separate approval required before use. |

`OMGSKILLS_H12_FIXTURES=1` is accepted only with either temporary mode, never
real-home mode. Browser URLs cannot set any launch option. A real-mode launch
initializes the private store, but writes no skill activation until approval.

For a separately requested manual simulated-home session, use the H1.2 setup
commands above with `OMGSKILLS_H13_TEST_HOME_ROOT` replacing
`OMGSKILLS_H1_INSTALL_ROOT`. Rebuild the test bundle first; never launch a second
copy. The harness supports `home-review`, `home-apply`, `home-inspect` and
`home-restore`, each followed by the marked sandbox path and `codex` or `claude`.
Its `home-kill-before`/`home-kill-after` commands exist only for process tests.
Every `home-*` harness command requires a temporary sandbox; none accepts a real home.

### Controlled agent-discovery check

The separate `OMGSKILLS_H13_DISCOVERY_ROOT=<marked sandbox>` setting requires
`OMGSKILLS_H13_REAL_INSTALLS=1`. This narrow exception uses embedded, non-executable
A/B fixture bytes, not synthetic public downloads. It accepts only
`omgskills/local-h13:omgskills-h13-check-20261006` and installs only the unique
`omgskills-h13-check-20261006` name in the locally selected agent folder. Normal
public links are rejected in this mode; the ordinary public mode rejects this ID
before networking. The browser cannot select the mode, version or destination.

`SKILL.md` asks the agent to read the adjacent `CHECK.txt`, which reports A or B.
There are no scripts or network requests. The same installer validates exact
built-in bytes, records, reviews, conflicts and activation. `select ROOT A|B`
chooses the candidate for the next review, not an already approved review.
Use `discovery-test.html`; the old public test page is intentionally incompatible.

Only after separate real-home approval, the harness supports
`discovery-inspect ROOT codex|claude --real-home` and
`discovery-remove ROOT codex|claude --real-home`. Removal refuses edited or foreign
state and unlinks only the verified test activation. It retains version files.
These commands initialize the private store; do not use them during preparation.
There is no real-home apply command: installation still requires helper consent.

Completed Codex session, file-read evidence and cleanup: `../../webwork-h13-manual-test.md`.
The test activation is removed, helper/server stopped and handler unregistered;
inactive versions and builds are retained. This does not prove signed setup.

H1.3 implementation/evidence: `../../webwork-h13-spec.md`. Signing, notarized
first launch, helper updates and distribution are separate later gates.
