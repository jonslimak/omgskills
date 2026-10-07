import assert from 'node:assert/strict';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { frameworkManifest, inventory, verifyLinkInputs, verifyStrings } from './verify-candidate.mjs';
import { fileSHA, helperID, sha256, verifyReleasePlist } from './release-contract.mjs';

export const frameworkRelative = 'Contents/Frameworks/Sparkle.framework';
const base = `${frameworkRelative}/Versions/B`;
export const signTargets = [
    `${base}/XPCServices/Installer.xpc`, `${base}/XPCServices/Downloader.xpc`,
    `${base}/Autoupdate`, `${base}/Updater.app`, frameworkRelative, '.',
];
const executables = [
    `${base}/XPCServices/Installer.xpc/Contents/MacOS/Installer`,
    `${base}/XPCServices/Downloader.xpc/Contents/MacOS/Downloader`, `${base}/Autoupdate`,
    `${base}/Updater.app/Contents/MacOS/Updater`, `${base}/Sparkle`, 'Contents/MacOS/OMGSkillsHelper',
];
const seals = new Set([
    `${base}/XPCServices/Installer.xpc/Contents/_CodeSignature/CodeResources`,
    `${base}/XPCServices/Downloader.xpc/Contents/_CodeSignature/CodeResources`,
    `${base}/Updater.app/Contents/_CodeSignature/CodeResources`, `${base}/_CodeSignature/CodeResources`,
    'Contents/_CodeSignature/CodeResources',
]);
const ticket = 'Contents/CodeResources';

export function parseSignature(text, { identifier, teamID, adhoc = false }) {
    const fields = Object.fromEntries(text.split('\n').filter(line => line.includes('=')).map(line => {
        const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
    }));
    assert.equal(fields.Identifier, identifier, 'Wrong signing identifier');
    if (adhoc) assert.equal(fields.Signature, 'adhoc');
    else {
        assert.notEqual(fields.Signature, 'adhoc');
        assert.equal(fields.TeamIdentifier, teamID, 'Wrong signing Team ID');
        assert.match(text, /^Authority=Developer ID Application: .+$/m);
        assert.ok(fields.Timestamp && fields.Timestamp !== 'none', 'Secure timestamp missing');
        assert.match(text, /flags=0x[0-9a-f]+\([^\n)]*runtime[\n)]/i, 'Hardened runtime missing');
    }
}

export function verifyEntitlements(relative, entitlements) {
    // This exact pinned binary has no sandbox requirement; Autoupdate alone carries its application identifier.
    const expected = relative === `${base}/Autoupdate`
        ? { 'com.apple.application-identifier': 'org.sparkle-project.Sparkle.Autoupdate' } : {};
    assert.deepEqual(entitlements, expected, `Unexpected entitlements: ${relative}`);
}

export function verifyDiskSignature(text, teamID) {
    assert.match(text, /^Identifier=com\.omgskills\.helper\.distribution$/m);
    assert.match(text, /^Authority=Developer ID Application: .+$/m);
    assert.ok(text.split('\n').includes(`TeamIdentifier=${teamID}`), 'Wrong disk-image Team ID');
    assert.match(text, /^Timestamp=(?!none$).+$/m);
    assert.doesNotMatch(text, /^Signature=adhoc$/m);
}

export function plistJSON(run, path) {
    return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path]));
}

export function entitlementsJSON(run, path) {
    const xml = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', path]);
    return xml.trim() ? JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml })) : {};
}

export function bundleManifest(app) {
    return inventory(app).sort().map(path => {
        const full = join(app, path), stat = lstatSync(full);
        return stat.isSymbolicLink() ? { path, link: readlinkSync(full) }
            : { path, mode: stat.mode & 0o777, sha256: fileSHA(full) };
    });
}

export function verifyManifestChange(before, after, { stapled = false } = {}) {
    const expected = before.filter(e => !seals.has(e.path));
    const actual = after.filter(e => !seals.has(e.path) && !(stapled && e.path === ticket));
    assert.deepEqual(actual, expected, 'Payload/layout/modes changed outside signing or stapling');
    for (const seal of seals) assert.ok(after.some(e => e.path === seal && e.sha256 && e.mode === 0o644), `Missing seal: ${seal}`);
}

// Re-sign stripped copies identically: stripping alone leaves signature-dependent __LINKEDIT sizes.
// This compares every resulting byte and never changes the original artifact.
function canonicalSignature(copy, run) {
    run('/usr/bin/codesign', ['--remove-signature', copy]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.omgskills.payload-comparison', copy]);
}

export function payloadManifest(app, run, scratch) {
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const owned = mkdtempSync(join(scratch, 'unsigned-comparison-'));
    try {
        return bundleManifest(app).map(entry => {
            if (!executables.includes(entry.path)) return entry;
            const copy = join(owned, sha256(entry.path));
            copyFileSync(join(app, entry.path), copy);
            canonicalSignature(copy, run);
            return { ...entry, sha256: fileSHA(copy) };
        });
    } finally { rmSync(owned, { recursive: true }); }
}

export function unsignedExecutableHash(file, run, scratch) {
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const owned = mkdtempSync(join(scratch, 'unsigned-executable-'));
    try {
        const copy = join(owned, 'executable');
        copyFileSync(file, copy);
        canonicalSignature(copy, run);
        return fileSHA(copy);
    } finally { rmSync(owned, { recursive: true }); }
}

export function verifyBundle(app, bin, c, version, run, { phase = 'prepared', baseline, identifiers, scratch } = {}) {
    assert.ok(['prepared', 'signed', 'stapled'].includes(phase));
    verifyReleasePlist(plistJSON(run, join(app, 'Contents/Info.plist')), c, version);
    const framework = join(app, frameworkRelative);
    const expected = frameworkManifest(join(bin, 'Sparkle.framework'));
    const allowed = [
        'Contents/Info.plist', 'Contents/MacOS/OMGSkillsHelper', 'Contents/_CodeSignature/CodeResources',
        ...expected.map(e => `${frameworkRelative}/${e.path}`),
    ];
    const files = inventory(app);
    if (phase === 'stapled' && files.includes(ticket)) allowed.push(ticket);
    assert.deepEqual(files.sort(), allowed.sort(), 'Unexpected release bundle files');
    if (phase === 'prepared') {
        assert.deepEqual(frameworkManifest(framework), expected, 'Framework differs from pinned dependency');
        assert.equal(unsignedExecutableHash(join(app, executables.at(-1)), run, scratch),
            unsignedExecutableHash(join(bin, 'OMGSkillsHelper'), run, scratch), 'Executable differs from build');
    }
    verifyLinkInputs(readFileSync(join(bin, 'OMGSkillsHelper.product/Objects.LinkFileList'), 'utf8'), bin);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const executable = join(app, executables.at(-1));
    verifyStrings(run('/usr/bin/nm', ['-j', executable]));
    const strings = run('/usr/bin/strings', ['-a', executable]);
    verifyStrings(strings);
    assert.ok(strings.includes('omgskills-helper') && strings.includes(helperID));
    assert.equal(run('/usr/bin/lipo', ['-archs', executable]).trim(), c.architecture);
    assert.match(run('/usr/bin/otool', ['-l', executable]), /path @executable_path\/\.\.\/Frameworks /);
    for (const relative of executables) {
        const file = join(app, relative);
        assert.ok(run('/usr/bin/lipo', ['-archs', file]).trim().split(/\s+/).includes(c.architecture));
        for (const line of run('/usr/bin/otool', ['-L', file]).trim().split('\n').slice(1)) {
            if (!line.includes('compatibility version')) continue;
            assert.match(line.trim(), /^(\/System\/Library\/|\/usr\/lib\/|@rpath\/Sparkle\.framework\/Versions\/B\/Sparkle\s)/);
        }
    }
    const foundIDs = {};
    for (const relative of signTargets) {
        const path = join(app, relative);
        verifyEntitlements(relative, entitlementsJSON(run, path));
        const text = run('/usr/bin/codesign', ['--display', '--verbose=4', path], { stderr: true });
        const identifier = /^Identifier=(.+)$/m.exec(text)?.[1];
        assert.ok(identifier);
        if (relative === '.') assert.equal(identifier, helperID);
        foundIDs[relative] = identifier;
        parseSignature(text, { identifier: phase === 'prepared' ? identifier : identifiers[relative],
            teamID: c.teamID, adhoc: phase === 'prepared' });
    }
    const payload = payloadManifest(app, run, scratch);
    if (phase !== 'prepared') verifyManifestChange(baseline, payload, { stapled: phase === 'stapled' });
    return { identifiers: foundIDs, payload, raw: bundleManifest(app) };
}
