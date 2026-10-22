# F3b Signed Candidate Setup, 2026-10-12

## Result

**Bounded first-time setup passed in the disposable Mac VM.** This is not
production release or existing-user migration acceptance. [verification.json](verification.json)
records the independent file checks and their limits.

- Safari handled the missing app with a retained request and retry/setup options.
- One interrupted download resumed successfully. The app was copied to the guest's
  Applications folder, the disk image ejected, and the final copy opened normally.
- macOS gave the normal Internet-download confirmation and reported Apple's
  malware check. No developer tools, admin password, Terminal-based install,
  remote access, or security bypass was needed.
- The original page revalidated the skill, required explicit Open and Safari
  Allow, then the app showed the exact pinned version and local installation review.
- Install succeeded. Codex listed Writing Guidelines after refreshing Skills;
  no agent/model run was used.
- Quit and browser retry cold-launched the same app with Already installed.
  A later measured warm retry preserved the installed bytes, provenance,
  file identities/timestamps and activation link, with one candidate process.

## Candidate And Hosting

- App: `OMGSkills Setup Test.app`, version/build `0.1.0` / `1`, arm64.
- Identity: `com.jonslimak.omgskills.setuptest`; scheme: `omgskills-setup-test`.
- DMG: `OMGSkills-Setup-Test-0.1.0-arm64.dmg`, 6,080,713 bytes.
- DMG SHA-256: `3cf340de60ae43f44d675a60bc485de8476e812c9c3e25fd366b83b5dd58effc`.
- [Dedicated test page](https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/):
  unlinked/noindex, publicly reachable, not production.
- Site `16f435c1-e5d0-4b40-b174-382d839e877b`;
  deploy `6accf8455624febf36c2f33c`; no Git deployment connection.
- Apple accepted app submission `5393e445-2d40-4f79-89bb-148314debae3`
  and DMG submission `a372e722-695b-4e03-bf79-381617213e1e`.
- Signature, stapling, host Gatekeeper and signed-payload comparisons passed
  before hosting. Hosted DMG digest matched the retained artifact.
- Root resource links initially prevented signing. The assembler was corrected
  to standard Contents/Resources layout with regression checks; 16 focused
  package/page tests passed during preparation. Failed and earlier bundles
  remain retained and must not be mistaken for this accepted candidate.

Build base is `dd1e7828` plus then-uncommitted candidate/packaging/web changes.
Exact source/artifact manifest hashes are in verification.json. Original
manifests, notary responses and hosting receipts remain under
`menubar/.build/setup-test-packages/candidate-38Efxz/`; this archive is a
bounded result record, not a newly rebuilt or committed release.

## Independent Verification

Guest `OMGSkills-F3b-Test-01`, macOS 26.3, user `omgtest`:

- Final executable: `/Users/omgtest/Applications/OMGSkills Setup Test.app/Contents/MacOS/omgskills-setup-test`.
- Exactly one matching process, PID 3197, before and after measured warm retry.
- Destination: `/Users/omgtest/.codex/skills/writing-guidelines`.
- Managed root: `/Users/omgtest/Library/Application Support/OMGSkills Setup Test/managed`.
- One package file, `SKILL.md`, 1,233 bytes. SHA-256
  `89a5f581193289b80af58b980090aeed535047c8df2b55ccbaae0de40283a99d`
  matched an independent HTTPS read at exact commit
  `063bee94c3f4df8453406c830b0a7df0f2860278`.
- The single-file source tree recomputed as
  `17d954cadfb8dec50bf0c707c9e7634be9ae9fe8`, blob
  `63facf310252a990d154bed12b3dcdd295ba771a`; provenance agreed.
  The managed file is read-only/non-executable, not an executable payload.
- The only other regular file was the 611-byte provenance record.
  Both hashes, inodes, sizes, modification/change times and link target were
  unchanged after browser retry and Done. No extra activation/package appeared.

Built-in read-only guest diagnostics were used **after** the normal setup flow.
Results were read from the rendered guest console; verification.json is a
transcription, not a guest-exported report. Terminal's request to access Downloads
was declined, so the guest DMG itself was not hashed. No permission bypass,
credential transfer, guest tools or file sharing was added.

## Limits And Next Step

Retry is a **no-reinstall**, not a network-free operation. Source inspection
shows package resolution precedes the no-op decision, including metadata/content
requests. No network trace or proof of zero temporary filesystem writes was
collected. No second app setup/download was requested through the UI.

The cold launch has UI evidence; the additional warm retry has independent
before/after state checks. This does not prove signed app upgrades, production
identity migration, broad catalog support, other browsers/architectures or G1-G4.
Click counts and end-to-end latency were not benchmarked because guest UI input
was unreliable.

Preserve the VM, signed candidate and hosted assets. No cleanup, commit, push,
public website change or Mac/Sparkle release was performed by this verification.
At verification closeout, the proposed step was scoped review/commit, then the signed-candidate skill
update check with Cancel and Apply. The update test is not yet prepared or run.

Documentation closeout re-ran all 16 package/page tests successfully. Evidence
digests matched retained artifacts; JSON parsed, local Markdown links resolved,
and `git diff --check` passed. No new native build or signing operation was run.
## Scoped Review Checkpoint

Subsequent approved review found no blocking issues. The 16 package/page tests,
29 native tests and test-page TypeScript check passed; one optional live-network
test was skipped. Native tests used the arm64 Release setup-test configuration
and temporary fixtures. Retained artifact digests and candidate source inputs
matched; JSON, local links and whitespace checks passed again.

This source checkpoint includes only this README and verification.json from the
ignored archive directory. Original receipts remain unchanged. Test binaries
were rebuilt, but the signed app/DMG was not rebuilt, re-signed or redeployed.
The verification.json boundaries describe the earlier verification, not this
later source commit. No push, production change, release or cleanup.
