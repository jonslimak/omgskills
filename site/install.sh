#!/bin/bash
# Installs the omgskills Mac app. Read it first: https://omgskills.com/install.sh
#
# What it does: downloads the signed omgskills app, checks it is ours, puts it in
# Applications and opens it. Nothing else: no background helpers, no hooks, no PATH
# changes, no sudo, and it never touches your skill folders.
# To remove omgskills later, quit it and drag omgskills.app to the Trash.
set -euo pipefail

# Kept in step with portal/src/app/unified/production-distribution.ts (checked by tests).
VERSION="0.0.37"
BUILD="37"
URL="https://github.com/jonslimak/omgskills/releases/download/connected-v0.0.37/OMGSkills-Connected-0.0.37-37-arm64.zip"
SHA256="db4ab8aa6c4955888d0fe523e8d63ccdb354c7886236068806bc48e8721ee167"
TEAM_ID="S4R7UHY755"
BUNDLE_ID="com.jonslimak.omgskills"
APP="omgskills.app"

APPLICATIONS_DIR="/Applications"
USER_APPLICATIONS_DIR="$HOME/Applications"
TRASH_DIR="$HOME/.Trash"

say() { printf 'omgskills: %s\n' "$*"; }
fail() { printf 'omgskills: %s\n' "$*" >&2; exit 1; }
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }

say "Installing the omgskills Mac app $VERSION into Applications."

# 1. This Mac
[ "$(uname -s)" = "Darwin" ] || fail "This installer is for Macs only."
[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] || fail "omgskills needs an Apple silicon Mac."
macos="$(sw_vers -productVersion)"
[ "${macos%%.*}" -ge 14 ] || fail "omgskills needs macOS 14 or later (this Mac has $macos)."

# 2. Already installed?
existing=""
for dir in "$APPLICATIONS_DIR" "$USER_APPLICATIONS_DIR"; do
  if [ -d "$dir/$APP" ] && [ "$(plist_value "$dir/$APP" CFBundleIdentifier)" = "$BUNDLE_ID" ]; then
    existing="$dir/$APP"
    break
  fi
done
if [ -n "$existing" ]; then
  existing_build="$(plist_value "$existing" CFBundleVersion)"
  existing_version="$(plist_value "$existing" CFBundleShortVersionString)"
  if [[ "$existing_build" =~ ^[0-9]+$ ]] && [ "$existing_build" -ge "$BUILD" ]; then
    say "omgskills $existing_version is already installed. Opening it."
    open "$existing"
    exit 0
  fi
  if pgrep -x omgskills >/dev/null 2>&1; then
    fail "An older omgskills is open. Quit it from the menu bar, then run this again."
  fi
fi

# 3. Download and check
work="$(mktemp -d "${TMPDIR:-/tmp}/omgskills-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT
say "Downloading..."
curl -fsSL --proto '=https' --tlsv1.2 "$URL" -o "$work/omgskills.zip" \
  || fail "The download failed. Try again, or download it from https://omgskills.com/download"
actual="$(shasum -a 256 "$work/omgskills.zip" | cut -d' ' -f1)"
[ "$actual" = "$SHA256" ] || fail "The download doesn't match the published checksum. Nothing was installed."
/usr/bin/ditto -x -k "$work/omgskills.zip" "$work/unzipped"
app="$work/unzipped/$APP"
[ -d "$app" ] || fail "The download doesn't contain $APP. Nothing was installed."
[ "$(plist_value "$app" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "Unexpected app in the download. Nothing was installed."
codesign --verify --deep --strict "$app" 2>/dev/null || fail "The app's signature is not valid. Nothing was installed."
team="$(codesign -dv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
[ "$team" = "$TEAM_ID" ] || fail "The app isn't signed by omgskills. Nothing was installed."
spctl --assess --type execute "$app" 2>/dev/null || fail "macOS did not approve the app. Nothing was installed."

# 4. Install
if [ -n "$existing" ]; then
  target_dir="$(dirname "$existing")"
  say "Moving the older omgskills $existing_version to the Trash."
  mkdir -p "$TRASH_DIR"
  mv "$existing" "$TRASH_DIR/omgskills-$existing_version-$(date +%s).app"
elif [ -w "$APPLICATIONS_DIR" ]; then
  target_dir="$APPLICATIONS_DIR"
else
  target_dir="$USER_APPLICATIONS_DIR"
  mkdir -p "$target_dir"
fi
/usr/bin/ditto "$app" "$target_dir/$APP"
open "$target_dir/$APP"

say "Installed in $target_dir and opened. Look for omgskills in the menu bar, then sign in."
say "To remove it later: quit omgskills and drag $APP to the Trash."
