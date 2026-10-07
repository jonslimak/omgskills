import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { verifyPlist } from './verify-candidate.mjs';

export const helperPath = 'experiments/browser-handoff';
export const validatorPath = 'menubar/Sources/omgskills/SkillPackageValidator.swift';
export const validatorLink = `${helperPath}/Sources/HandoffCore/SkillPackageValidator.swift`;
export const feedURL = 'https://omgskills.com/helper/updates/appcast.xml';
export const downloadPrefix = 'https://omgskills.com/helper/updates/';
export const helperID = 'com.omgskills.helper';
export const rehearsalKey = Buffer.alloc(32, 0x71).toString('base64');
export const packagerFiles = ['package-helper.mjs', 'release-contract.mjs', 'verify-release.mjs', 'finalize-helper.mjs', 'verify-candidate.mjs'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileSHA = path => sha256(readFileSync(path));
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

function exactKeys(object, keys) {
    assert.ok(object && typeof object === 'object' && !Array.isArray(object));
    assert.deepEqual(Object.keys(object).sort(), [...keys].sort(), 'Unexpected or missing configuration fields');
}

function releaseNumber(value) {
    exactKeys(value, ['version', 'build']);
    assert.match(value.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(value.version.split('.').every(n => Number.isSafeInteger(Number(n))));
    assert.match(value.build, /^[1-9]\d*$/);
    assert.ok(Number.isSafeInteger(Number(value.build)));
}

function newer(next, previous) {
    assert.ok(Number(next.build) > Number(previous.build), 'Builds must strictly increase');
    const a = next.version.split('.').map(Number), b = previous.version.split('.').map(Number);
    const first = a.findIndex((v, i) => v !== b[i]);
    assert.ok(first >= 0 && a[first] > b[first], 'Versions must strictly increase');
}

export function validateConfig(c) {
    exactKeys(c, ['schema', 'profile', 'sourceCommit', 'versions', 'previousRelease', 'architecture',
        'feedURL', 'publicKey', 'teamID', 'signingIdentity', 'sparkleAccount', 'notaryProfile']);
    assert.equal(c.schema, 1);
    assert.ok(['rehearsal', 'release'].includes(c.profile));
    assert.match(c.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(c.architecture, 'arm64');
    assert.equal(c.feedURL, feedURL);
    assert.equal(c.sparkleAccount, helperID);
    assert.equal(typeof c.publicKey, 'string');
    const key = Buffer.from(c.publicKey, 'base64');
    assert.ok(key.length === 32 && key.some(b => b !== 0) && key.toString('base64') === c.publicKey, 'Invalid public key');
    assert.ok(Array.isArray(c.versions) && c.versions.length === 2, 'Exactly two controlled versions required');
    c.versions.forEach(releaseNumber);
    newer(c.versions[1], c.versions[0]);
    if (c.previousRelease !== null) {
        releaseNumber(c.previousRelease);
        newer(c.versions[0], c.previousRelease);
    }
    if (c.profile === 'rehearsal') {
        assert.equal(c.publicKey, rehearsalKey);
        for (const key of ['teamID', 'signingIdentity', 'notaryProfile']) assert.equal(c[key], null);
    } else {
        assert.notEqual(c.publicKey, rehearsalKey, 'Synthetic key cannot be finalized');
        assert.match(c.teamID, /^[A-Z0-9]{10}$/);
        assert.match(c.signingIdentity, /^[A-F0-9]{40}$/, 'Use certificate fingerprint, never a private key');
        assert.match(c.notaryProfile, /^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/, 'Use a named Keychain profile');
    }
    return c;
}

export function releasePlist(dormant, c, version) {
    verifyPlist(dormant);
    validateConfig(c);
    assert.ok(c.versions.some(v => v.version === version.version && v.build === version.build));
    return { ...dormant, CFBundleShortVersionString: version.version, CFBundleVersion: version.build,
        OMGSkillsHelperUpdatesEnabled: true, SUFeedURL: c.feedURL, SUPublicEDKey: c.publicKey };
}

export function verifyReleasePlist(plist, c, version) {
    const dormant = { ...plist, CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1', OMGSkillsHelperUpdatesEnabled: false };
    delete dormant.SUFeedURL;
    delete dormant.SUPublicEDKey;
    verifyPlist(dormant);
    assert.deepEqual(plist, releasePlist(dormant, c, version));
}

// The output root is fixed. Reject links in every existing component, including dangling links.
export function noLinks(path) {
    const absolute = resolve(path);
    if (absolute !== dirname(absolute)) noLinks(dirname(absolute));
    try { assert.ok(!lstatSync(absolute).isSymbolicLink(), `Symlink refused: ${absolute}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return absolute;
}

export function runDirectory(repo, id, { create = false } = {}) {
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,63}$/, 'Use a simple run ID, not a path');
    const root = join(realpathSync(repo), helperPath, '.release-artifacts');
    noLinks(root);
    const run = join(root, id);
    noLinks(run);
    if (create) {
        try { lstatSync(run); assert.fail('Run already exists; never overwrite artifacts'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        mkdirSync(root, { recursive: true, mode: 0o700 });
        mkdirSync(run, { mode: 0o700 });
    } else {
        assert.ok(lstatSync(run).isDirectory());
    }
    return run;
}

export function ownedPath(run, relative) {
    const path = resolve(run, relative);
    assert.ok(path.startsWith(realpathSync(run) + sep), 'Output escaped run directory');
    noLinks(path);
    return path;
}

export function writeJSON(path, value, { exclusive = false } = {}) {
    noLinks(path);
    if (exclusive) {
        writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } else {
        const temporary = `${path}.writing`;
        noLinks(temporary);
        writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
    }
}

export function parseSnapshotListing(listing) {
    const entries = listing.split('\0').filter(Boolean).map(row => {
        const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t([^\n\r]+)$/.exec(row);
        assert.ok(match, 'Unexpected git entry type');
        const [, mode, oid, path] = match;
        assert.ok(path.startsWith(helperPath + '/') || path === validatorPath);
        assert.ok(path.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.')) || path === `${helperPath}/.gitignore`);
        if (mode === '120000') assert.equal(path, validatorLink, 'Unexpected source symlink');
        return { mode, oid, path };
    });
    assert.equal(new Set(entries.map(e => e.path.toLowerCase())).size, entries.length, 'Case-colliding source paths');
    for (const path of [`${helperPath}/Package.swift`, `${helperPath}/Package.resolved`, `${helperPath}/Helper-Info.plist`, validatorPath, validatorLink]) {
        assert.ok(entries.some(e => e.path === path), `Missing frozen source: ${path}`);
    }
    return entries;
}
