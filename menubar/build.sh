#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="omgskills"
DIST_DIR="dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
INDEX_SKILLS="../index/skills.json"
TRENDING_SKILLS="../index/trending.json"
X_TRENDING_SKILLS="../index/x-trending.json"
DATA_MANIFEST="../site/data/manifest.json"

if [ ! -f "$INDEX_SKILLS" ]; then
    echo "✗ $INDEX_SKILLS missing — run 'cd ../index && npm run scrape' first." >&2
    exit 1
fi

echo "→ swift build (release)"
swift build -c release

BIN_DIR=$(swift build -c release --show-bin-path)

echo "→ Assembling $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$APP_BUNDLE/Contents/Frameworks"

cp "$BIN_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/"
cp Info.plist "$APP_BUNDLE/Contents/"
cp "$INDEX_SKILLS" "$APP_BUNDLE/Contents/Resources/skills.json"
if [ -f "$TRENDING_SKILLS" ]; then
    cp "$TRENDING_SKILLS" "$APP_BUNDLE/Contents/Resources/trending.json"
fi
if [ -f "$X_TRENDING_SKILLS" ]; then
    cp "$X_TRENDING_SKILLS" "$APP_BUNDLE/Contents/Resources/x-trending.json"
fi
if [ -f "$DATA_MANIFEST" ]; then
    cp "$DATA_MANIFEST" "$APP_BUNDLE/Contents/Resources/manifest.json"
fi
cp Assets/omgskills.icns "$APP_BUNDLE/Contents/Resources/omgskills.icns"
cp Sources/omgskills/Resources/marked.min.js "$APP_BUNDLE/Contents/Resources/marked.min.js"
cp Sources/omgskills/Resources/x-twitter-logo-block.png "$APP_BUNDLE/Contents/Resources/x-twitter-logo-block.png"

# Copy dynamic frameworks produced by SwiftPM. Use ditto to preserve framework symlinks.
find "$BIN_DIR" -maxdepth 1 -name "*.framework" -type d -print0 | while IFS= read -r -d '' framework; do
    /usr/bin/ditto "$framework" "$APP_BUNDLE/Contents/Frameworks/$(basename "$framework")"
done

# SwiftPM-built executables look next to themselves for binary frameworks.
# Packaged apps keep frameworks in Contents/Frameworks.
if ! otool -l "$APP_BUNDLE/Contents/MacOS/$APP_NAME" | grep -q "@executable_path/../Frameworks"; then
    install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
fi

# Copy any SPM-generated resource bundles (e.g. KeyboardShortcuts localizations)
find "$BIN_DIR" -maxdepth 1 -name "*.bundle" -exec cp -R {} "$APP_BUNDLE/Contents/Resources/" \; 2>/dev/null || true

test -f "$APP_BUNDLE/Contents/Resources/marked.min.js"
test -f "$APP_BUNDLE/Contents/Resources/x-twitter-logo-block.png"

# Local/dev only. Public downloads must be produced by scripts/release-mac.sh,
# which replaces this ad-hoc signature with Developer ID signing + notarization.
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null

echo "✓ Built $APP_BUNDLE"
echo "  Launch: open $APP_BUNDLE"
echo "  Public release: ../scripts/release-mac.sh"
