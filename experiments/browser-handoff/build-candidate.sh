#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
OUTPUT="$HERE/.candidate-app"

require_stopped() {
    if /usr/bin/pgrep -x OMGSkillsHelper >/dev/null; then
        printf '%s\n' 'Quit OMGSkills Helper before building another candidate.' >&2
        exit 1
    else
        status=$?
        if [ "$status" -ne 1 ]; then
            printf '%s\n' 'Could not check running helpers; no candidate will be published.' >&2
            exit 1
        fi
    fi
}

require_stopped
if [ -L "$OUTPUT" ] || { [ -e "$OUTPUT" ] && [ ! -d "$OUTPUT" ]; }; then
    printf '%s\n' 'Candidate output must be a real directory, not a link or file.' >&2
    exit 1
fi
mkdir -p "$OUTPUT"
# Every run is isolated: never replace an existing app or reuse stale object files.
BUILD=$(mktemp -d /private/tmp/omgskills-h14-candidate.XXXXXX)
ARTIFACT=$(mktemp -d "$OUTPUT/candidate.XXXXXX")
APP="$ARTIFACT/OMGSkills Helper.app"
printf 'Build evidence: %s\nCandidate directory: %s\n' "$BUILD" "$ARTIFACT"

swift package --package-path "$HERE" describe --type json > "$BUILD/package.json"
node "$HERE/verify-candidate.mjs" graph "$BUILD/package.json"
CLANG_MODULE_CACHE_PATH="$BUILD/module-cache" swift build --package-path "$HERE" \
    --build-path "$BUILD/swift-build" --force-resolved-versions -c release --product OMGSkillsHelper -Xswiftc -warnings-as-errors
swift package --package-path "$BUILD/swift-build/checkouts/Sparkle" dump-package > "$BUILD/sparkle-package.json"
node "$HERE/verify-candidate.mjs" dependency "$HERE/Package.resolved" "$BUILD/sparkle-package.json"
BIN=$(swift build --package-path "$HERE" --build-path "$BUILD/swift-build" -c release --show-bin-path)
require_stopped
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks"
cp "$HERE/Helper-Info.plist" "$APP/Contents/Info.plist"
cp "$BIN/OMGSkillsHelper" "$APP/Contents/MacOS/OMGSkillsHelper"
/usr/bin/cmp "$BIN/OMGSkillsHelper" "$APP/Contents/MacOS/OMGSkillsHelper"
/usr/bin/ditto "$BIN/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
# Local inspection only. Never uses a Developer ID or touches a release feed.
/usr/bin/codesign --force --sign - "$APP"
node "$HERE/verify-candidate.mjs" bundle "$APP" "$BIN"
printf 'Verified local candidate (not launched or registered): %s\n' "$APP"
