#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="omgskills"
DIST_DIR="dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
INDEX_SKILLS="../index/skills.json"

if [ ! -f "$INDEX_SKILLS" ]; then
    echo "✗ $INDEX_SKILLS missing — run 'cd ../index && npm run scrape' first." >&2
    exit 1
fi

echo "→ swift build (release)"
swift build -c release

BIN_DIR=$(swift build -c release --show-bin-path)

echo "→ Assembling $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

cp "$BIN_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/"
cp Info.plist "$APP_BUNDLE/Contents/"
cp "$INDEX_SKILLS" "$APP_BUNDLE/Contents/Resources/skills.json"

# Copy any SPM-generated resource bundles (e.g. KeyboardShortcuts localizations)
find "$BIN_DIR" -maxdepth 1 -name "*.bundle" -exec cp -R {} "$APP_BUNDLE/Contents/Resources/" \; 2>/dev/null || true

echo "✓ Built $APP_BUNDLE"
echo "  Launch: open $APP_BUNDLE"
