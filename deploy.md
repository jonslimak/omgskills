# Deploy Checklist

Use this checklist for Mac app releases so the website download and Sparkle updater do not break.

## Why This Matters

`site/downloads/` and `site/updates/` are ignored by Git. That means a normal Git-based Netlify deploy can publish the site without the DMG or Sparkle update zip.

For Mac releases, always build the release assets locally and deploy the local `site/` folder.

## Required Flow

1. Build and package the Mac release:

```bash
./scripts/release-mac.sh <version>
```

2. Confirm the release assets exist:

```bash
ls -lh site/downloads/omgskills-mac.dmg
ls -lh site/downloads/omgskills-mac.dmg.sha256
ls -lh site/updates/omgskills-<version>.zip
grep "omgskills-<version>.zip" site/appcast.xml
```

3. Deploy the local site folder:

```bash
netlify deploy --prod --dir=site
```

4. Verify production:

```bash
curl -I https://omgskills.com/download
curl -I https://omgskills.com/downloads/omgskills-mac.dmg
curl -I https://omgskills.com/appcast.xml
curl -I https://omgskills.com/updates/omgskills-<version>.zip
```

The `/download` check should return `302` to `/downloads/omgskills-mac.dmg`. The DMG, appcast, and update zip checks should return `200`.

## Download Links

Primary website CTAs should link directly to `/downloads/omgskills-mac.dmg`.

Keep `/download` only as a legacy redirect to `/downloads/omgskills-mac.dmg`. Do not use JavaScript-triggered downloads because some ad, privacy, and in-app browsers block scripted downloads.

## Cache Rules

Keep `/downloads/*` and `/updates/*` short-cache in `netlify.toml`.

Do not set these paths to long immutable caching. If a release file is missing, long caching can make the broken download stick.

## Commit Rules

Use an app commit when changing:

- Swift app code
- app version numbers
- Sparkle update logic
- signing or release scripts
- app assets
- DMG layout

Use a web commit when changing:

- website HTML, CSS, or JavaScript
- Netlify config
- download link or redirect behavior
- deploy docs

Use a release commit when app and web release metadata change together:

- `site/appcast.xml`
- release checksums
- release notes
- version bump

Do not expect files in `site/downloads/` or `site/updates/` to appear in Git commits. They are deployed assets, not tracked source.

## Assumptions

- Release binaries stay out of Git.
- Netlify remains the production host.
- Stable download URL stays `/downloads/omgskills-mac.dmg`.
- Legacy `/download` redirects to the stable DMG URL.
