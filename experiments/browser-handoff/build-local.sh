#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="${TMPDIR:-/private/tmp}/omgskills-h0-handoff"
APP="$HERE/.test-app/OMGSkills Handoff Test.app"

if pgrep -x OmgskillsHandoff >/dev/null; then
    printf '%s\n' 'Quit OMGSkills Handoff Test before replacing its bundle.' >&2
    exit 1
else
    status=$?
    if [ "$status" -ne 1 ]; then
        printf '%s\n' 'Could not verify whether the test helper is running; bundle left unchanged.' >&2
        exit 1
    fi
fi

swift build --package-path "$HERE" --build-path "$ROOT/swift-build" -c release
mkdir -p "$APP/Contents/MacOS"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/swift-build/release/OmgskillsHandoff" "$APP/Contents/MacOS/OmgskillsHandoff"
codesign --force --sign - "$APP"
printf '%s\n' "$APP"
