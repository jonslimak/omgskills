# Rollout Plan

## Goal

Ship the new library through a new app release without forcing old app versions onto the new data.

Core rule:

- old app versions stay on the old data path
- new app versions use the new data path
- transition happens when users update the app

## Chosen Rollout Model

### Old app

- keeps reading the old remote manifest/data path
- old path is frozen during rollout
- old app is not required to support the new library

### New app

- ships with updated runtime wiring for the new library
- reads a new remote manifest/data path
- becomes active only after the user updates or installs fresh

## Current Reality

The app and site now support versioned routing:

- old app track: `https://omgskills.com/data/manifest.json`
- new app track: `https://omgskills.com/data/v2/manifest.json`

That means rollout can happen by app version, without forcing old clients onto the new library.

## Required Changes

### 1. Version the remote data path

Recommended paths:

- old app path: `/data/manifest.json`
- new app path: `/data/v2/manifest.json`

Rules:

- do not overwrite the old path with new-library data during rollout
- keep old and new manifests isolated
- each manifest should point to its own asset set

### 2. Freeze the old data path

During rollout:

- keep the old manifest and its hashed assets intact
- do not keep refreshing that old path unless we explicitly decide to later

This keeps old installed apps stable.

### 3. Point the new app to the new path

The new app release should:

- use the new manifest URL
- refresh only against the new library/data path
- keep normal bundled fallback behavior

### 4. Remove the temporary Library dropdown

Before shipping the new app:

- remove the temporary `Library` dropdown from the menubar UI
- remove the visible `production` vs `shadow` switch from release UX
- keep only one production source for end users

Shadow helpers can remain for dev/test only if still useful, but they should not stay user-visible.

## Rollout Sequence

1. Freeze the current old production data path
   - preserve current `/data/manifest.json`

2. Publish the new library/data to a new path
   - recommended: `/data/v2/manifest.json`

3. Update the app
   - new app version points to `/data/v2/manifest.json`
   - remove the temporary `Library` dropdown in this release

4. Release the Mac app
   - follow `deploy.md` exactly

5. User transition
   - old installed apps keep using old data
   - users who update start using new data
   - new downloads get the new app and therefore the new data path immediately

6. Later cleanup
   - retire the old path only after rollout is established

## Rollback

Rollback is data-first.

- old app path stays untouched: `/data/manifest.json`
- new app path is the rollback surface: `/data/v2/manifest.json`
- do not plan on auto-downgrading already-updated clients

### Failure types

#### 1. New library/data issue

- keep old `/data/manifest.json` unchanged
- restore `/data/v2/manifest.json` and its referenced assets to the last known-good v2 publish
- do not move old apps to the new library
- verify the new app refreshes cleanly after the v2 rollback

#### 2. New app binary issue

- stop offering the bad build to new users
- update the website download target away from the bad DMG
- update `site/appcast.xml` so not-yet-updated users are not offered the bad version
- do not rely on client downgrade for already-updated users
- ship a fixed higher version through the normal `deploy.md` release flow
- keep v2 data rollback available separately if the app still runs and only the new data is the problem

### Rollback sequence

1. Classify the issue
   - data-only
   - app binary
   - both

2. Pause further rollout
   - stop publishing fresh v2 data
   - remove or replace the bad download/appcast entry if the app build is the problem

3. Execute rollback
   - data issue: restore the last known-good `/data/v2/manifest.json` asset set
   - app issue: revert public download/appcast for not-yet-updated users, then ship a hotfix forward release

4. Verify rollback
   - old app still reads old data path
   - new app reads the intended safe v2 path after rollback
   - download URL, appcast, and manifest URLs resolve correctly

### What rollback does not mean

- old apps do not need to read the new library
- already-updated clients will not auto-downgrade
- updated clients recover through v2 data rollback or a new fixed app release

## Release Rules

Follow `deploy.md` exactly for Mac releases.

Important rules:

- build release assets locally
- deploy the local `site/` folder
- do not rely on a Git-only Netlify deploy for Mac release assets

Required release flow:

1. update `CHANGELOG.md`
2. run:
   - `./scripts/release-mac.sh <version>`
3. verify:
   - `site/downloads/omgskills-mac.dmg`
   - `site/downloads/omgskills-mac.dmg.sha256`
   - `site/updates/omgskills-<version>.zip`
   - `site/appcast.xml`
4. commit release metadata and push
5. deploy:
   - `./scripts/deploy-site-prod.sh`
6. create GitHub release:
   - `gh release create v<version> --title "<version>" --notes "See CHANGELOG.md"`
7. verify production:
   - `/download`
   - `/downloads/omgskills-mac.dmg`
   - `/appcast.xml`
   - `/updates/omgskills-<version>.zip`

## Acceptance Criteria

We are ready to execute rollout when:

- old app versions still resolve only the old data path
- new app version resolves only the new data path
- temporary `Library` dropdown is removed
- new app refreshes successfully from the new manifest
- old manifest remains intact during rollout
- release artifacts and Sparkle update flow verify cleanly

Rollback is ready when:

- `site/data/manifest.json` still serves the frozen old track
- `site/data/v2/manifest.json` serves the intended safe new-track data
- `/downloads/omgskills-mac.dmg` points to the intended safe installer
- `site/appcast.xml` no longer promotes the bad build
- a fresh new-app install and an old-app install both follow the expected track

## Notes

- Live rerun determinism is not treated as a rollout blocker.
- The bridge is considered stable enough for cutover.
- Remaining live-data drift is an upstream proof limitation, not a production-safety failure.
- True downgrade support for already-updated app clients is out of scope.
