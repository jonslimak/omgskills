# Standalone public-package preview (H1.1)

Local experiment only. No installer, updater, private auth, or public-app dependency.
The same isolated H0 bundle and `omgskills-helper-test` scheme now support a real
pinned package preview. Links accept only the two fixture IDs; the helper resolves
their pins through the public OMGSkills MCP endpoint and downloads from GitHub
over HTTPS. It verifies tree/blob hashes and validates paths and package limits
before staging. It never writes to an agent's skill directory or executes content.

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

Preview staging is temporary and non-executable. Files are removed before
success is displayed. A force-kill during staging may leave a directory named
`omgskills-h1-preview-<UUID>` under the current user's temporary directory;
it is never an installed skill and must not be treated as a trusted resume point.
