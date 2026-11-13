#!/bin/bash
# Installs the omgskills Mac app. Read it first: https://omgskills.com/install.sh
#
# What it does: downloads the signed omgskills app, checks it is ours, puts it in
# Applications and opens it. An older omgskills app is moved to the Trash, and only
# after the new one is ready. Nothing else: no background helpers, no hooks, no PATH
# changes, no sudo, and it never touches your skill folders.
# To remove omgskills later, quit it and drag omgskills.app to the Trash.
set -euo pipefail

# Kept in step with portal/src/app/unified/production-distribution.ts (checked by tests).
VERSION="0.0.39"
BUILD="39"
URL="https://github.com/jonslimak/omgskills/releases/download/connected-v0.0.39/OMGSkills-Connected-0.0.39-39-arm64.zip"
SHA256="29c1efcd17317e803d24d3c4168b8f90f3cace49ba9d40a9521af474d0a38b42"
TEAM_ID="S4R7UHY755"
BUNDLE_ID="com.jonslimak.omgskills"
APP="omgskills.app"
APPLICATIONS_DIR="/Applications"
USER_APPLICATIONS_DIR="$HOME/Applications"
TRASH_DIR="$HOME/.Trash"

say() { printf 'omgskills: %s\n' "$*"; }
fail() { printf 'omgskills: %s\n' "$*" >&2; exit 1; }
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }
build_of() { local build; build="$(plist_value "$1" CFBundleVersion)"; [[ "$build" =~ ^[0-9]+$ ]] && echo "$build" || echo 0; }
is_ours() { [ -d "$1" ] && [ "$(plist_value "$1" CFBundleIdentifier)" = "$BUNDLE_ID" ]; }

work=""
staged=""
cleanup() {
  if [ -n "$staged" ] && [ -e "$staged" ]; then rm -rf "$staged"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}

# Everything runs from main, called on the last line, so a download of this script that
# stops partway runs nothing.
main() {
  say "Installing the omgskills Mac app $VERSION into Applications."

  # 1. This Mac
  [ "$(uname -s)" = "Darwin" ] || fail "This installer is for Macs only."
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] || fail "omgskills needs an Apple silicon Mac."
  local macos
  macos="$(sw_vers -productVersion)"
  [ "${macos%%.*}" -ge 14 ] || fail "omgskills needs macOS 14 or later (this Mac has $macos)."

  # 2. Already installed? Use the newest copy in either Applications folder.
  local existing="" existing_build=0 dir
  for dir in "$APPLICATIONS_DIR" "$USER_APPLICATIONS_DIR"; do
    if is_ours "$dir/$APP" && { [ -z "$existing" ] || [ "$(build_of "$dir/$APP")" -gt "$existing_build" ]; }; then
      existing="$dir/$APP"
      existing_build="$(build_of "$existing")"
    fi
  done
  local existing_version=""
  if [ -n "$existing" ]; then
    existing_version="$(plist_value "$existing" CFBundleShortVersionString)"
    if [ "$existing_build" -ge "$BUILD" ]; then
      say "omgskills $existing_version is already installed. Opening it."
      open "$existing"
      exit 0
    fi
    if pgrep -x omgskills >/dev/null 2>&1; then
      fail "An older omgskills is open. Quit it from the menu bar, then run this again."
    fi
  fi

  # Where it goes: next to the older copy, else Applications, else ~/Applications.
  local target_dir
  if [ -n "$existing" ]; then
    target_dir="$(dirname "$existing")"
  elif [ -w "$APPLICATIONS_DIR" ]; then
    target_dir="$APPLICATIONS_DIR"
  else
    target_dir="$USER_APPLICATIONS_DIR"
  fi
  if [ -e "$target_dir/$APP" ] && [ "$target_dir/$APP" != "$existing" ]; then
    fail "$target_dir/$APP is not the omgskills app. Move it out of the way, then run this again."
  fi

  # 3. Download and check
  work="$(mktemp -d "${TMPDIR:-/tmp}/omgskills-install.XXXXXX")"
  trap cleanup EXIT
  say "Downloading..."
  curl -fsSL --proto '=https' --tlsv1.2 "$URL" -o "$work/omgskills.zip" \
    || fail "The download failed. Try again, or download it from https://omgskills.com/download"
  local actual
  actual="$(shasum -a 256 "$work/omgskills.zip" | cut -d' ' -f1)"
  [ "$actual" = "$SHA256" ] || fail "The download doesn't match the published checksum. Nothing was installed."
  /usr/bin/ditto -x -k "$work/omgskills.zip" "$work/unzipped"
  local app="$work/unzipped/$APP"
  [ -d "$app" ] || fail "The download doesn't contain $APP. Nothing was installed."
  is_ours "$app" || fail "Unexpected app in the download. Nothing was installed."
  codesign --verify --deep --strict "$app" 2>/dev/null || fail "The app's signature is not valid. Nothing was installed."
  local team
  team="$(codesign -dv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
  [ "$team" = "$TEAM_ID" ] || fail "The app isn't signed by omgskills. Nothing was installed."
  spctl --assess --type execute "$app" 2>/dev/null || fail "macOS did not approve the app. Nothing was installed."

  # 4. Install: copy in under a temporary name first, then swap, so a failure leaves the
  #    older app where it was.
  mkdir -p "$target_dir"
  staged="$target_dir/.omgskills-installing-$$.app"
  /usr/bin/ditto "$app" "$staged" || fail "Couldn't copy the app into $target_dir. Nothing was changed."
  if [ -n "$existing" ]; then
    local trashed
    trashed="$TRASH_DIR/omgskills-$existing_version-$(date +%s).app"
    mkdir -p "$TRASH_DIR"
    mv "$existing" "$trashed" || fail "Couldn't move the older omgskills to the Trash. Nothing was changed."
    if ! mv "$staged" "$target_dir/$APP"; then
      mv "$trashed" "$existing" || true
      fail "Couldn't finish installing. Your older omgskills was put back."
    fi
    say "Moved the older omgskills $existing_version to the Trash."
  else
    mv "$staged" "$target_dir/$APP" || fail "Couldn't finish installing into $target_dir."
  fi
  staged=""
  open "$target_dir/$APP"

  say "Installed in $target_dir and opened. Look for omgskills in the menu bar, then sign in."
  say "To remove it later: quit omgskills and drag $APP to the Trash."
}

main "$@"
