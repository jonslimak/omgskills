#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="${TMPDIR:-/private/tmp}/omgskills-h0-handoff"
APP="$HERE/.test-app/OMGSkills Handoff Test.app"

swift build --package-path "$HERE" --build-path "$ROOT/swift-build" -c release --product OmgskillsHandoff
mkdir -p "$APP/Contents/MacOS"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/swift-build/release/OmgskillsHandoff" "$APP/Contents/MacOS/OmgskillsHandoff"
codesign --force --sign - "$APP"
printf '%s\n' "$APP"
