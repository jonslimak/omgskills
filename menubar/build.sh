#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="omgskills"
DIST_DIR="dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
INDEX_SKILLS="../index/skills.json"
TRENDING_SKILLS="../index/trending.json"
X_TRENDING_SKILLS="../index/x-trending.json"
DATA_TRACK_SUBDIR="${OMGSKILLS_DATA_SUBDIR:-v2}"
if [ -n "${OMGSKILLS_DATA_MANIFEST_PATH:-}" ]; then
    DATA_MANIFEST="$OMGSKILLS_DATA_MANIFEST_PATH"
elif [ -n "$DATA_TRACK_SUBDIR" ]; then
    DATA_MANIFEST="../site/data/$DATA_TRACK_SUBDIR/manifest.json"
else
    DATA_MANIFEST="../site/data/manifest.json"
fi

if [ ! -f "$INDEX_SKILLS" ]; then
    echo "✗ $INDEX_SKILLS missing — run 'cd ../index && npm run scrape' first." >&2
    exit 1
fi

if [ ! -f "$DATA_MANIFEST" ]; then
    echo "✗ $DATA_MANIFEST missing — publish the target data track first." >&2
    exit 1
fi

require_promoted_v2_library() {
    export OMGSKILLS_REPO_ROOT="$(cd .. && pwd)"
    python3 - <<'PY'
import json, os, sys
from pathlib import Path

repo = Path(os.environ["OMGSKILLS_REPO_ROOT"])
report_path = repo / "index/shadow/shadow-report.json"
cutover_path = repo / "index/shadow/skills.cutover.shadow.json"
skills_path = repo / "index/skills.json"

for path, hint in [
    (report_path, "Run the shadow cutover flow first."),
    (cutover_path, "Run the shadow cutover flow first."),
    (skills_path, "Run promote-cutover first."),
]:
    if not path.exists():
        print(f"✗ Missing {path}", file=sys.stderr)
        print(f"  {hint}", file=sys.stderr)
        sys.exit(1)

report = json.loads(report_path.read_text())
if not report.get("cutoverValidationPassed"):
    print("✗ v2 build requires a passing cutover validation.", file=sys.stderr)
    print("  Run the shadow cutover flow and fix validation failures first.", file=sys.stderr)
    sys.exit(1)

cutover = json.loads(cutover_path.read_text())
promoted = [
    skill for skill in cutover
    if not (not skill.get("author_handle") and skill.get("provenance_type") in {"catalog", "repackaged"})
]
current = json.loads(skills_path.read_text())

promoted_ids = [skill["id"] for skill in promoted]
current_ids = [skill["id"] for skill in current]
if promoted_ids != current_ids:
    print("✗ v2 build is not using the promoted library state.", file=sys.stderr)
    print("  Run promote-cutover before building the v2 app bundle.", file=sys.stderr)
    sys.exit(1)
PY
}

if [ "$DATA_TRACK_SUBDIR" = "v2" ] || [ "${OMGSKILLS_DATA_MANIFEST_PATH:-}" = "../site/data/v2/manifest.json" ]; then
    require_promoted_v2_library
fi

echo "→ swift build (release)"
swift build -c release

BIN_DIR=$(swift build -c release --show-bin-path)

echo "→ Assembling $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$APP_BUNDLE/Contents/Frameworks"

cp "$BIN_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/"
cp Info.plist "$APP_BUNDLE/Contents/"
CALLBACK_SCHEME=$(/usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes:0:CFBundleURLSchemes:0" "$APP_BUNDLE/Contents/Info.plist")
if [ "$CALLBACK_SCHEME" != "omgskills" ]; then
    echo "✗ Built app is missing the omgskills callback scheme." >&2
    exit 1
fi
PORTAL_CONNECT_URL=$(/usr/libexec/PlistBuddy -c "Print :OMGSkillsPortalConnectURL" "$APP_BUNDLE/Contents/Info.plist")
if [[ "$PORTAL_CONNECT_URL" != https://* ]]; then
    echo "✗ Built app has an invalid portal connect URL." >&2
    exit 1
fi
cp "$INDEX_SKILLS" "$APP_BUNDLE/Contents/Resources/skills.json"
if [ -f "$TRENDING_SKILLS" ]; then
    cp "$TRENDING_SKILLS" "$APP_BUNDLE/Contents/Resources/trending.json"
fi
if [ -f "$X_TRENDING_SKILLS" ]; then
    cp "$X_TRENDING_SKILLS" "$APP_BUNDLE/Contents/Resources/x-trending.json"
fi
cp "$DATA_MANIFEST" "$APP_BUNDLE/Contents/Resources/manifest.json"
DATA_MANIFEST="$DATA_MANIFEST" \
APP_RESOURCES="$APP_BUNDLE/Contents/Resources" \
python3 - <<'PY'
import json
import os
import shutil
from pathlib import Path

manifest_path = Path(os.environ["DATA_MANIFEST"])
resources_dir = Path(os.environ["APP_RESOURCES"])
manifest = json.loads(manifest_path.read_text())

for asset_key in ("collections", "shaHistory"):
    asset = manifest.get(asset_key)
    if not asset or not asset.get("path"):
        continue
    source = manifest_path.parent / asset["path"]
    if not source.exists():
        raise SystemExit(f"✗ Missing {asset_key} asset referenced by manifest: {source}")
    shutil.copy2(source, resources_dir / source.name)
PY
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
