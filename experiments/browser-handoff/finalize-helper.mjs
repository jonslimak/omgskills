import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadPrefix, fileSHA, helperID, helperPath, noLinks, ownedPath, packagerFiles,
    readJSON, runDirectory, sha256, validateConfig, writeJSON } from './release-contract.mjs';
import { bundleManifest, entitlementsJSON, plistJSON, signTargets, verifyBundle,
    verifyDiskSignature, verifyEntitlements } from './verify-release.mjs';

// State is persisted before irreversible work. An unknown submission outcome never authorizes another upload.
export class FinalizationJournal {
    constructor(path, configSHA256, run) {
        this.path = path;
        this.run = run;
        this.state = existsSync(path) ? readJSON(path) : { schema: 1, configSHA256, steps: {}, submissions: {} };
        assert.equal(this.state.schema, 1);
        assert.equal(this.state.configSHA256, configSHA256);
    }
    save() { writeJSON(this.path, this.state); }
    step(name, action) {
        const existing = this.state.steps[name];
        if (existing?.status === 'done') return existing.result;
        assert.ok(!existing, `Stage ${name} is incomplete. Inspect/re-plan; do not overwrite or retry blindly.`);
        this.state.steps[name] = { status: 'running' };
        this.save();
        const result = action() ?? null;
        this.state.steps[name] = { status: 'done', result };
        this.save();
        return result;
    }
    notarize(name, archive, profile, logPath) {
        const hash = fileSHA(archive);
        let record = this.state.submissions[name];
        if (!record) {
            record = this.state.submissions[name] = { status: 'submission-outcome-unknown', sha256: hash };
            this.save();
            const response = JSON.parse(this.run('/usr/bin/xcrun', ['notarytool', 'submit', archive,
                '--keychain-profile', profile, '--output-format', 'json']));
            assert.match(response.id, /^[a-f0-9-]{36}$/i, 'Submission ID missing; reconcile with Apple before retrying');
            record.id = response.id;
            record.status = 'submitted';
            this.save();
        }
        assert.equal(record.sha256, hash, 'Submitted archive changed');
        assert.ok(record.id, 'Unknown submission outcome. Reconcile with Apple; no duplicate upload allowed.');
        assert.notEqual(record.status, 'rejected', 'Rejected by Apple; inspect retained log and re-plan');
        if (record.status === 'accepted') {
            assert.equal(fileSHA(logPath), record.logSHA256);
            return record;
        }
        const response = JSON.parse(this.run('/usr/bin/xcrun', ['notarytool', 'wait', record.id,
            '--keychain-profile', profile, '--output-format', 'json', '--timeout', '10m']));
        assert.equal(response.id, record.id);
        if (response.status === 'In Progress') throw new Error(`Apple submission ${record.id} pending; resume this run later`);
        const log = JSON.parse(this.run('/usr/bin/xcrun', ['notarytool', 'log', record.id,
            '--keychain-profile', profile]));
        assert.equal(log.jobId, record.id);
        assert.equal(log.sha256?.toLowerCase(), hash);
        writeJSON(logPath, log, { exclusive: true });
        record.logSHA256 = fileSHA(logPath);
        record.status = response.status === 'Accepted' && log.status === 'Accepted' ? 'accepted' : 'rejected';
        this.save();
        assert.equal(record.status, 'accepted', 'Notarization rejected; see retained log');
        return record;
    }
}

export function signingCommands(app, c, identifiers, entitlementFiles = {}) {
    validateConfig(c);
    assert.equal(c.profile, 'release');
    return signTargets.map(relative => {
        const identifier = identifiers[relative];
        assert.ok(identifier && !identifier.includes('\n'));
        if (relative === '.') assert.equal(identifier, helperID);
        const args = ['--force', '--sign', c.signingIdentity, '--options', 'runtime', '--timestamp', '--identifier', identifier];
        if (entitlementFiles[relative]) args.push('--entitlements', entitlementFiles[relative]);
        args.push(join(app, relative));
        return { command: '/usr/bin/codesign', args };
    });
}

export function verifySigningInputs(c, identityOutput, publicKey, macPublicKey) {
    validateConfig(c);
    assert.equal(c.profile, 'release');
    assert.equal(publicKey.trim(), c.publicKey, 'Keychain helper public key does not match release configuration');
    assert.notEqual(c.publicKey, macPublicKey, 'Mac app key cannot be reused');
    assert.ok(identityOutput.split('\n').some(line => line.includes(c.signingIdentity)
        && line.includes('Developer ID Application:') && line.includes(`(${c.teamID})`)), 'Expected valid Developer ID identity unavailable');
}

function verifyFeed(feed, versions, c, run, tools) {
    const value = expression => run('/usr/bin/xmllint', ['--nonet', '--xpath', expression, feed]).trim();
    assert.ok(!readFileSync(feed, 'utf8').includes('<!DOCTYPE'), 'External XML declarations refused');
    assert.equal(Number(value('count(/rss/channel/item)')), versions.length);
    assert.equal(Number(value('count(//*[local-name()="deltas"])')), 0);
    const builds = new Set();
    for (let index = 1; index <= versions.length; index++) {
        const item = `/rss/channel/item[${index}]`;
        const field = name => value(`string(${item}/*[local-name()="${name}"])`);
        const attr = name => value(`string(${item}/enclosure/@*[local-name()="${name}"])`);
        const build = field('version');
        const version = versions.find(v => v.build === build);
        assert.ok(version && !builds.has(build));
        builds.add(build);
        assert.equal(field('shortVersionString'), version.version);
        assert.equal(field('minimumSystemVersion'), '14.0');
        // The pinned generator infers this from the app's Mach-O slices.
        assert.ok(['', 'macos'].includes(attr('os')), 'Unexpected enclosure OS');
        assert.equal(field('hardwareRequirements'), 'arm64');
        assert.equal(Number(value(`count(${item}/enclosure)`)), 1);
        assert.equal(attr('url'), `${downloadPrefix}${version.filename}`);
        assert.equal(Number(attr('length')), statSync(version.dmg).size);
        const signature = attr('edSignature');
        assert.equal(Buffer.from(signature, 'base64').length, 64);
        run(join(tools, 'sign_update'), ['--account', c.sparkleAccount, '--verify', version.dmg, signature]);
    }
    run(join(tools, 'sign_update'), ['--account', c.sparkleAccount, '--verify', feed]);
}

export function finalize(repo, id, { approved = false, run, verify = verifyBundle } = {}) {
    assert.equal(approved, true, 'Finalization requires separate signing and Apple-upload approval');
    const directory = runDirectory(repo, id);
    const path = relative => ownedPath(directory, relative);
    const c = validateConfig(readJSON(path('config.json')));
    assert.equal(c.profile, 'release', 'A synthetic/ad-hoc rehearsal cannot be finalized');
    assert.ok(typeof run === 'function');
    const prepared = readJSON(path('prepared.json'));
    assert.equal(prepared.schema, 1);
    assert.equal(prepared.sourceCommit, c.sourceCommit);
    assert.equal(prepared.profile, 'release');
    assert.equal(prepared.status, 'prepared-not-for-distribution');
    assert.equal(prepared.configSHA256, fileSHA(path('config.json')));
    assert.equal(prepared.committedPackager, true);
    for (const file of packagerFiles) {
        assert.equal(fileSHA(join(repo, helperPath, file)), prepared.packager[file], 'Packager changed; re-prepare reviewed source');
        assert.equal(fileSHA(path(`source/${helperPath}/${file}`)), prepared.packager[file]);
    }
    assert.equal(fileSHA(path('source-manifest.json')), prepared.sourceManifestSHA256);
    for (const entry of readJSON(path('source-manifest.json')).filter(e => e.mode !== '120000')) {
        assert.equal(fileSHA(path(`source/${entry.path}`)), entry.sha256, 'Frozen source changed');
    }
    assert.ok(!existsSync(path('ready.json')), 'Run already finalized; no overwriting releases');
    const lock = path('finalize.lock');
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    try {
        const tools = path('swift-build/artifacts/sparkle/Sparkle/bin');
        for (const [tool, hash] of Object.entries(prepared.sparkle.tools)) assert.equal(fileSHA(join(tools, tool)), hash);
        const bin = path('swift-build/arm64-apple-macosx/release');
        verifySigningInputs(c, run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']),
            run(join(tools, 'generate_keys'), ['--account', c.sparkleAccount, '-p']),
            plistJSON(run, join(repo, 'menubar/Info.plist')).SUPublicEDKey);
        const notaryAccess = JSON.parse(run('/usr/bin/xcrun', ['notarytool', 'history',
            '--keychain-profile', c.notaryProfile, '--output-format', 'json']));
        assert.ok(Array.isArray(notaryAccess.history), 'Notary credential preflight failed');
        const j = new FinalizationJournal(path('finalize-journal.json'), prepared.configSHA256, run);
        const archives = [];
        for (const version of c.versions) {
            const prefix = `build-${version.build}`, app = path(`${prefix}/OMGSkills Helper.app`);
            const manifestFile = path(`${prefix}/prepared-manifest.json`);
            assert.equal(fileSHA(manifestFile), prepared.versions.find(v => v.build === version.build)?.manifestSHA256);
            const baseline = readJSON(manifestFile);
            const verification = phase => verify(app, bin, c, version, run, {
                phase, baseline: baseline.payload, identifiers: baseline.identifiers, scratch: path('scratch'),
            });
            j.step(`${prefix}:sign`, () => {
                assert.deepEqual(bundleManifest(app), baseline.raw, 'Prepared app changed');
                verification('prepared');
                const entitlementFiles = {};
                for (const relative of signTargets) {
                    const entitlements = entitlementsJSON(run, join(app, relative));
                    verifyEntitlements(relative, entitlements);
                    if (Object.keys(entitlements).length) {
                        const file = path(`${prefix}/entitlements-${sha256(relative)}.plist`);
                        writeFileSync(file, JSON.stringify(entitlements), { flag: 'wx', mode: 0o600 });
                        run('/usr/bin/plutil', ['-convert', 'xml1', file]);
                        entitlementFiles[relative] = file;
                    }
                }
                for (const cmd of signingCommands(app, c, baseline.identifiers, entitlementFiles)) run(cmd.command, cmd.args);
                const result = verification('signed');
                writeJSON(path(`${prefix}/signed-manifest.json`), result, { exclusive: true });
                return { manifestSHA256: fileSHA(path(`${prefix}/signed-manifest.json`)) };
            });
            const zip = path(`${prefix}/apple-submission.zip`);
            j.step(`${prefix}:zip`, () => {
                verification('signed');
                run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
                return { sha256: fileSHA(zip) };
            });
            assert.equal(fileSHA(zip), j.state.steps[`${prefix}:zip`].result.sha256);
            j.notarize(`${prefix}:app`, zip, c.notaryProfile, path(`${prefix}/app-notary-log.json`));
            j.step(`${prefix}:staple-app`, () => {
                verification('signed');
                run('/usr/bin/xcrun', ['stapler', 'staple', app]);
                run('/usr/bin/xcrun', ['stapler', 'validate', app]);
                const result = verification('stapled');
                writeJSON(path(`${prefix}/stapled-manifest.json`), result, { exclusive: true });
                run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
                return { manifestSHA256: fileSHA(path(`${prefix}/stapled-manifest.json`)) };
            });
            verification('stapled');
            const filename = `OMGSkills-Helper-${version.version}-${version.build}-arm64.dmg`;
            const dmg = path(`${prefix}/${filename}`);
            j.step(`${prefix}:dmg`, () => {
                const imageRoot = path(`${prefix}/dmg-source`);
                mkdirSync(imageRoot);
                run('/usr/bin/ditto', [app, join(imageRoot, 'OMGSkills Helper.app')]);
                symlinkSync('/Applications', join(imageRoot, 'Applications'));
                run('/usr/bin/hdiutil', ['create', '-srcfolder', imageRoot, '-volname', 'OMGSkills Helper', '-format', 'UDZO', dmg]);
                run('/usr/bin/codesign', ['--sign', c.signingIdentity, '--timestamp', '--identifier', `${helperID}.distribution`, dmg]);
                run('/usr/bin/codesign', ['--verify', '--strict', dmg]);
                verifyDiskSignature(run('/usr/bin/codesign', ['--display', '--verbose=4', dmg], { stderr: true }), c.teamID);
                return { sha256: fileSHA(dmg) };
            });
            // Notarization used the pre-stapling bytes; never resubmit the subsequently stapled disk image.
            if (!j.state.steps[`${prefix}:staple-dmg`]) {
                assert.equal(fileSHA(dmg), j.state.steps[`${prefix}:dmg`].result.sha256);
                j.notarize(`${prefix}:dmg`, dmg, c.notaryProfile, path(`${prefix}/dmg-notary-log.json`));
            } else assert.equal(j.state.submissions[`${prefix}:dmg`]?.status, 'accepted');
            j.step(`${prefix}:staple-dmg`, () => {
                run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
                run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
                run('/usr/bin/codesign', ['--verify', '--strict', dmg]);
                run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg]);
                return { sha256: fileSHA(dmg) };
            });
            assert.equal(fileSHA(dmg), j.state.steps[`${prefix}:staple-dmg`].result.sha256);
            verifyDiskSignature(run('/usr/bin/codesign', ['--display', '--verbose=4', dmg], { stderr: true }), c.teamID);
            j.step(`${prefix}:mount-check`, () => {
                const mount = path(`${prefix}/mounted-image`);
                mkdirSync(mount);
                // Always detach our mount point, including when attaching partly succeeds then reports an error.
                try {
                    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]);
                    const mountedApp = join(mount, 'OMGSkills Helper.app');
                    assert.deepEqual(bundleManifest(mountedApp), bundleManifest(app));
                    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp]);
                    run('/usr/bin/xcrun', ['stapler', 'validate', mountedApp]);
                } finally { run('/usr/bin/hdiutil', ['detach', mount]); }
                return { verified: true };
            });
            archives.push({ ...version, filename, dmg, sha256: fileSHA(dmg),
                appManifestSHA256: fileSHA(path(`${prefix}/stapled-manifest.json`)) });
        }
        const feedStaging = path('feed-staging'), feed = join(feedStaging, 'appcast.xml');
        j.step('feed', () => {
            mkdirSync(feedStaging);
            for (const version of archives) copyFileSync(version.dmg, join(feedStaging, version.filename));
            run(join(tools, 'generate_appcast'), ['--account', c.sparkleAccount, '--maximum-deltas', '0',
                '--download-url-prefix', downloadPrefix, feedStaging]);
            verifyFeed(feed, archives, c, run, tools);
            for (const version of archives) assert.equal(fileSHA(join(feedStaging, version.filename)), version.sha256);
            return { sha256: fileSHA(feed) };
        });
        assert.equal(fileSHA(feed), j.state.steps.feed.result.sha256);
        verifyFeed(feed, archives, c, run, tools);
        for (const version of archives) {
            assert.equal(fileSHA(version.dmg), version.sha256);
            assert.equal(fileSHA(join(feedStaging, version.filename)), version.sha256);
        }
        writeJSON(path('ready.json'), { schema: 1, status: 'verified-local-only-not-hosted', sourceCommit: c.sourceCommit,
            preparedSHA256: fileSHA(path('prepared.json')), journalSHA256: fileSHA(path('finalize-journal.json')),
            bundleID: helperID, architecture: c.architecture, teamID: c.teamID, publicKeySHA256: sha256(Buffer.from(c.publicKey, 'base64')),
            versions: archives, feed: { path: feed, sha256: fileSHA(feed) }, hosted: false, launched: false }, { exclusive: true });
    } finally {
        noLinks(lock);
        rmSync(lock);
    }
}
