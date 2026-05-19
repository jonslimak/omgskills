#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MENUBAR_DIR="$REPO_ROOT/menubar"
APP_NAME="omgskills"
APP="$MENUBAR_DIR/dist/$APP_NAME.app"
ZIP="$MENUBAR_DIR/dist/omgskills-mac.zip"
ZIP_CHECKSUM="$ZIP.sha256"
DMG="$MENUBAR_DIR/dist/omgskills-mac.dmg"
DMG_CHECKSUM="$DMG.sha256"
SITE_DOWNLOADS="$REPO_ROOT/site/downloads"
SITE_UPDATES="$REPO_ROOT/site/updates"
REDIRECTS_FILE="$REPO_ROOT/site/_redirects"
SPARKLE_TOOLS="$MENUBAR_DIR/.build/artifacts/sparkle/Sparkle/bin"
INFO_PLIST="$MENUBAR_DIR/Info.plist"
APPLICATIONS_ICON="$MENUBAR_DIR/Assets/Applications.ico"
DMG_BACKGROUND_PNG="$MENUBAR_DIR/Assets/dmg-background.png"
IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
VERSION="${1:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")}"

fail() {
    echo "✗ $*" >&2
    exit 1
}

require_tool() {
    local name="$1"
    local help_text="${2:-Install or expose '$name' in PATH.}"
    if ! command -v "$name" >/dev/null 2>&1; then
        fail "Required tool '$name' was not found. $help_text"
    fi
}

require_file() {
    local path="$1"
    local help_text="${2:-Expected file is missing.}"
    if [ ! -e "$path" ]; then
        fail "Required file '$path' is missing. $help_text"
    fi
}

require_clean_zip() {
    local zip_path="$1"
    if zipinfo -1 "$zip_path" | grep -E '(^|/)(\._|__MACOSX)' >/dev/null; then
        fail "Release zip '$zip_path' contains AppleDouble metadata files. Refusing to ship a Gatekeeper-breaking archive."
    fi
}

require_env() {
    local name="$1"
    if [ -z "${!name:-}" ]; then
        fail "Missing required environment variable '$name'. See README release instructions."
    fi
}

sign_item() {
    local item="$1"
    if [ -e "$item" ]; then
        codesign --force --timestamp --options runtime --sign "$IDENTITY" "$item"
    fi
}

package_app() {
    local output_zip="$1"
    rm -f "$output_zip"
    /usr/bin/ditto -c -k --norsrc --keepParent "$APP_NAME.app" "$(basename "$output_zip")"
    require_file "$output_zip" "Zip packaging failed."
    require_clean_zip "$output_zip"
}

apply_custom_icon() {
    local target="$1"
    local icon_source="$2"
    local icon_ext="${icon_source##*.}"
    local icon_work="$MENUBAR_DIR/dist/applications-icon.$icon_ext"
    local icon_rsrc="$MENUBAR_DIR/dist/applications-folder.rsrc"

    cp "$icon_source" "$icon_work"
    sips -i "$icon_work" >/dev/null
    xcrun DeRez -only icns "$icon_work" > "$icon_rsrc"
    xcrun Rez -append "$icon_rsrc" -o "$target"
    SetFile -a C "$target"
    rm -f "$icon_work" "$icon_rsrc"
}

package_dmg() {
    local output_dmg="$1"
    local rw_dmg="$MENUBAR_DIR/dist/omgskills-mac-rw.dmg"
    local mount_dir="$MENUBAR_DIR/dist/dmg-mount"

    rm -rf "$mount_dir" "$output_dmg" "$rw_dmg"
    mkdir -p "$mount_dir"
    hdiutil create \
        -size 160m \
        -fs HFS+ \
        -volname "$APP_NAME" \
        -ov \
        "$rw_dmg"
    hdiutil attach "$rw_dmg" -mountpoint "$mount_dir" -nobrowse -noautoopen
    /usr/bin/ditto "$APP" "$mount_dir/$APP_NAME.app"
    mkdir -p "$mount_dir/.background"
    cp "$DMG_BACKGROUND_PNG" "$mount_dir/.background/background.png"
    MOUNT_DIR="$mount_dir" osascript <<'APPLESCRIPT'
tell application "Finder"
    set targetFolder to POSIX file "/Applications" as alias
    set containerFolder to POSIX file (system attribute "MOUNT_DIR") as alias
    set backgroundPicture to POSIX file ((system attribute "MOUNT_DIR") & "/.background/background.png") as alias
    make new alias file at containerFolder to targetFolder with properties {name:"Applications"}
    open containerFolder
    delay 1
    set dmgWindow to window of containerFolder
    set current view of dmgWindow to icon view
    set toolbar visible of dmgWindow to false
    set statusbar visible of dmgWindow to false
    set bounds of dmgWindow to {100, 100, 840, 520}
    set arrangement of icon view options of dmgWindow to not arranged
    set icon size of icon view options of dmgWindow to 128
    set background picture of icon view options of dmgWindow to backgroundPicture
    set position of item "Applications" of containerFolder to {205, 220}
    set position of item "omgskills.app" of containerFolder to {615, 220}
    update containerFolder without registering applications
    delay 1
    close dmgWindow
end tell
APPLESCRIPT
    apply_custom_icon "$mount_dir/Applications" "$APPLICATIONS_ICON"
    sync
    hdiutil detach "$mount_dir"
    hdiutil convert "$rw_dmg" -format UDZO -o "$output_dmg"
    rm -rf "$mount_dir" "$rw_dmg"
    require_file "$output_dmg" "DMG packaging failed."
}

notarize_file() {
    local file="$1"
    xcrun notarytool submit "$file" \
        --key "$ASC_PRIVATE_KEY_PATH" \
        --key-id "$ASC_KEY_ID" \
        --issuer "$ASC_ISSUER_ID" \
        --wait
}

verify_identity() {
    if ! security find-identity -v -p codesigning 2>/dev/null | grep -F "$IDENTITY" >/dev/null; then
        fail "Developer ID identity '$IDENTITY' was not found in your keychain."
    fi
}

preflight() {
    echo "→ Running release preflight"
    require_tool codesign
    require_tool xcrun
    require_tool spctl
    require_tool ditto
    require_tool hdiutil
    require_tool osascript
    require_tool shasum
    require_tool security
    require_tool sips
    require_tool SetFile
    require_file /usr/libexec/PlistBuddy "This script expects macOS PlistBuddy at /usr/libexec/PlistBuddy."
    require_env DEVELOPER_ID_APPLICATION
    require_env ASC_PRIVATE_KEY_PATH
    require_env ASC_KEY_ID
    require_env ASC_ISSUER_ID
    require_file "$ASC_PRIVATE_KEY_PATH" "Set ASC_PRIVATE_KEY_PATH to your App Store Connect API key .p8 file."
    require_file "$INFO_PLIST" "menubar/Info.plist must exist so the release version can be read."
    require_file "$APPLICATIONS_ICON" "Expected the DMG Applications icon asset to exist."
    require_file "$DMG_BACKGROUND_PNG" "Expected the DMG background asset to exist."
    require_file "$SPARKLE_TOOLS/generate_appcast" "Build the app dependencies first so Sparkle tools are present."
    if ! xcrun --find notarytool >/dev/null 2>&1; then
        fail "Apple notarytool is unavailable through xcrun."
    fi
    if ! xcrun --find stapler >/dev/null 2>&1; then
        fail "Apple stapler is unavailable through xcrun."
    fi
    verify_identity
}

preflight

cd "$MENUBAR_DIR"
./build.sh
require_file "$APP" "menubar/build.sh should produce dist/$APP_NAME.app."

echo "→ Removing extended metadata before signing"
xattr -cr "$APP" 2>/dev/null || true

echo "→ Signing nested Sparkle helpers"
find "$APP" -path "*/XPCServices/*.xpc" -print0 | while IFS= read -r -d '' item; do
    sign_item "$item"
done
find "$APP" -path "*/Updater.app" -print0 | while IFS= read -r -d '' item; do
    sign_item "$item"
done
find "$APP" -path "*/Autoupdate" -type f -print0 | while IFS= read -r -d '' item; do
    sign_item "$item"
done
find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework" -print0 | while IFS= read -r -d '' item; do
    sign_item "$item"
done

echo "→ Signing app"
sign_item "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "→ Packaging for notarization"
rm -f "$ZIP" "$ZIP_CHECKSUM" "$DMG" "$DMG_CHECKSUM"
cd "$MENUBAR_DIR/dist"
package_app "$ZIP"

echo "→ Notarizing app zip"
notarize_file "$(basename "$ZIP")"

echo "→ Stapling"
cd "$REPO_ROOT"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=4 "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "→ Repackaging stapled app"
cd "$MENUBAR_DIR/dist"
rm -f "$ZIP" "$ZIP_CHECKSUM" "$DMG" "$DMG_CHECKSUM"
package_app "$ZIP"
shasum -a 256 "$(basename "$ZIP")" | tee "$(basename "$ZIP_CHECKSUM")"
require_file "$ZIP_CHECKSUM" "Zip checksum file was not created."

echo "→ Packaging DMG"
package_dmg "$DMG"

echo "→ Signing DMG"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
codesign --verify --verbose=2 "$DMG"

echo "→ Notarizing DMG"
notarize_file "$(basename "$DMG")"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"
shasum -a 256 "$(basename "$DMG")" | tee "$(basename "$DMG_CHECKSUM")"
require_file "$DMG_CHECKSUM" "DMG checksum file was not created."

RELEASE_HASH="$(awk '{print substr($1, 1, 8)}' "$(basename "$DMG_CHECKSUM")")"
DOWNLOAD_ZIP="omgskills-mac-$RELEASE_HASH.zip"
DOWNLOAD_ZIP_CHECKSUM="$DOWNLOAD_ZIP.sha256"
DOWNLOAD_DMG="omgskills-mac-$RELEASE_HASH.dmg"
DOWNLOAD_DMG_CHECKSUM="$DOWNLOAD_DMG.sha256"

echo "→ Updating site download and Sparkle appcast"
mkdir -p "$SITE_DOWNLOADS" "$SITE_UPDATES"
cp "$DMG" "$SITE_DOWNLOADS/omgskills-mac.dmg"
cp "$DMG_CHECKSUM" "$SITE_DOWNLOADS/omgskills-mac.dmg.sha256"
cp "$DMG" "$SITE_DOWNLOADS/$DOWNLOAD_DMG"
cp "$DMG_CHECKSUM" "$SITE_DOWNLOADS/$DOWNLOAD_DMG_CHECKSUM"
cp "$ZIP" "$SITE_DOWNLOADS/omgskills-mac.zip"
cp "$ZIP_CHECKSUM" "$SITE_DOWNLOADS/omgskills-mac.zip.sha256"
cp "$ZIP" "$SITE_DOWNLOADS/$DOWNLOAD_ZIP"
cp "$ZIP_CHECKSUM" "$SITE_DOWNLOADS/$DOWNLOAD_ZIP_CHECKSUM"
cp "$ZIP" "$SITE_UPDATES/omgskills-$VERSION.zip"

if grep -q '^/download ' "$REDIRECTS_FILE"; then
    sed -i '' "s#^/download .*#/download /downloads/omgskills-mac.dmg 302#" "$REDIRECTS_FILE"
else
    printf '/download /downloads/omgskills-mac.dmg 302\n' >> "$REDIRECTS_FILE"
fi
if grep -q '^/download/ ' "$REDIRECTS_FILE"; then
    sed -i '' "s#^/download/ .*#/download/ /downloads/omgskills-mac.dmg 302#" "$REDIRECTS_FILE"
else
    printf '/download/ /downloads/omgskills-mac.dmg 302\n' >> "$REDIRECTS_FILE"
fi

"$SPARKLE_TOOLS/generate_appcast" \
    --download-url-prefix "https://omgskills.com/updates/" \
    --link "https://omgskills.com" \
    -o "$REPO_ROOT/site/appcast.xml" \
    "$SITE_UPDATES"

echo "✓ Release ready"
echo "  Version: $VERSION"
echo "  App: $APP"
echo "  Zip: $ZIP"
echo "  Zip checksum: $ZIP_CHECKSUM"
echo "  DMG: $DMG"
echo "  DMG checksum: $DMG_CHECKSUM"
echo "  Download: $SITE_DOWNLOADS/$DOWNLOAD_DMG"
echo "  Appcast: $REPO_ROOT/site/appcast.xml"
