import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { downloadPrefix, feedURL, fileSHA, helperID, helperPath, ownedPath, packagerFiles, parseSnapshotListing, readJSON, rehearsalKey,
    releasePlist, runDirectory, validateConfig, validatorLink, validatorPath, verifyReleasePlist } from './release-contract.mjs';
import { allowPreparationCommand, extractSnapshot, prepare } from './package-helper.mjs';
import { finalize, FinalizationJournal, signingCommands, verifySigningInputs } from './finalize-helper.mjs';
import { bundleManifest, parseSignature, signTargets, verifyDiskSignature, verifyEntitlements, verifyManifestChange } from './verify-release.mjs';
import { verifyPlist } from './verify-candidate.mjs';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = () => ({ schema: 1, profile: 'release', sourceCommit: 'a'.repeat(40),
    previousRelease: null, versions: [{ version: '0.1.0', build: '1' }, { version: '0.1.1', build: '2' }],
    architecture: 'arm64', feedURL, publicKey: Buffer.alloc(32, 9).toString('base64'),
    teamID: 'ABC1234567', signingIdentity: 'A'.repeat(40), sparkleAccount: helperID, notaryProfile: 'helper-notary' });
const rehearsal = () => ({ ...config(), profile: 'rehearsal', publicKey: rehearsalKey,
    teamID: null, signingIdentity: null, notaryProfile: null });
const dormant = () => ({ CFBundleExecutable: 'OMGSkillsHelper', CFBundleIdentifier: helperID,
    CFBundleName: 'OMGSkills Helper', CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1',
    LSMinimumSystemVersion: '14.0', LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: helperID, CFBundleURLSchemes: ['omgskills-helper'] }],
    OMGSkillsHelperUpdatesEnabled: false, SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false,
    SUAllowsAutomaticUpdates: false, SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true,
    SURequireSignedFeed: true, SUSignedFeedFailureExpirationInterval: 0 });

function temporary(t) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'helper-packaging-test-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

test('release inputs require fixed identity/feed/key/architecture and increasing pair', () => {
    validateConfig(config());
    validateConfig(rehearsal());
    for (const mutation of [
        c => delete c.teamID, c => { c.extra = 'secret'; }, c => { c.feedURL = 'https://omgskills.com/updates/appcast.xml'; },
        c => { c.sparkleAccount = 'ed25519'; }, c => { c.publicKey = rehearsalKey; },
        c => { c.publicKey = Buffer.alloc(32).toString('base64'); }, c => { c.publicKey += '\n'; },
        c => { c.teamID = 'wrong'; }, c => { c.architecture = 'x86_64'; }, c => { c.sourceCommit = 'HEAD'; },
        c => { c.signingIdentity = 'private-key'; }, c => { c.notaryProfile = '../profile'; },
        c => { c.versions[1].build = '1'; }, c => { c.versions[1].version = '0.0.9'; },
        c => { c.previousRelease = c.versions[0]; }, c => { c.versions[0].build = '9007199254740993'; },
    ]) { const c = config(); mutation(c); assert.throws(() => validateConfig(c)); }
});

test('release plist is explicit, source and candidate verification remain dormant', () => {
    const original = dormant(), before = structuredClone(original), c = config();
    const release = releasePlist(original, c, c.versions[1]);
    assert.deepEqual(original, before);
    verifyPlist(original);
    verifyReleasePlist(release, c, c.versions[1]);
    assert.throws(() => verifyPlist(release));
    for (const change of [{ SURequireSignedFeed: false }, { SUFeedURL: 'https://evil.example' },
        { SUDefaultsDomain: 'com.omgskills.app' }, { CFBundleIdentifier: 'com.omgskills.app' },
        { SUPublicEDKey: rehearsalKey }, { SUEnableAutomaticChecks: true }, { CFBundleVersion: '1' }]) {
        assert.throws(() => verifyReleasePlist({ ...release, ...change }, c, c.versions[1]));
    }
});

test('output creation refuses traversal, symlinks and overwrites without touching public paths', t => {
    const root = temporary(t);
    mkdirSync(join(root, helperPath), { recursive: true });
    mkdirSync(join(root, 'site'));
    writeFileSync(join(root, 'site/appcast.xml'), 'public-unchanged');
    for (const id of ['../site', '/Applications/App.app', '.', 'foo/bar']) assert.throws(() => runDirectory(root, id, { create: true }));
    symlinkSync(join(root, 'site'), join(root, helperPath, '.release-artifacts'));
    assert.throws(() => runDirectory(root, 'test', { create: true }));
    rmSync(join(root, helperPath, '.release-artifacts'));
    const run = runDirectory(root, 'test', { create: true });
    assert.throws(() => runDirectory(root, 'test', { create: true }));
    assert.throws(() => ownedPath(run, '../site'));
    symlinkSync('/nonexistent-dangling', join(run, 'alias'));
    assert.throws(() => ownedPath(run, 'alias/file'));
    assert.equal(readFileSync(join(root, 'site/appcast.xml'), 'utf8'), 'public-unchanged');
});

test('source snapshot includes the external validator and refuses foreign links/submodules', t => {
    const entries = [`${helperPath}/Package.swift`, `${helperPath}/Package.resolved`, `${helperPath}/Helper-Info.plist`, validatorPath]
        .map(path => `100644 blob ${'b'.repeat(40)}\t${path}`);
    entries.push(`120000 blob ${'c'.repeat(40)}\t${validatorLink}`);
    const listing = entries.join('\0') + '\0';
    const parsed = parseSnapshotListing(listing);
    for (const extra of [`160000 commit ${'a'.repeat(40)}\t${helperPath}/submodule`,
        `120000 blob ${'a'.repeat(40)}\t${helperPath}/link`, `100644 blob ${'a'.repeat(40)}\tsite/secret`,
        `100644 blob ${'a'.repeat(40)}\t${helperPath}/../outside`,
        `100644 blob ${'a'.repeat(40)}\t${helperPath}/package.swift`]) {
        assert.throws(() => parseSnapshotListing(listing + extra));
    }
    const root = temporary(t), snapshot = join(root, 'snapshot');
    extractSnapshot(parsed.map(e => ({ ...e, bytes: Buffer.from(e.path === validatorLink
        ? '../../../../menubar/Sources/omgskills/SkillPackageValidator.swift' : 'committed contents') })), snapshot);
    assert.equal(readFileSync(join(snapshot, validatorLink), 'utf8'), 'committed contents');
    assert.deepEqual(readdirSync(snapshot).sort(), ['experiments', 'menubar']);
});

test('preparation command policy never permits Keychain, signing credentials, Apple, launch or hosting', () => {
    for (const command of ['/usr/bin/security', '/usr/bin/xcrun', '/usr/bin/open', '/usr/bin/curl',
        '/bin/sh', '/tools/generate_keys', '/tools/sign_update', '/tools/generate_appcast']) {
        assert.throws(() => allowPreparationCommand(command, []));
    }
    allowPreparationCommand('/usr/bin/codesign', ['--force', '--sign', '-', '/owned/app']);
    allowPreparationCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '/owned/app']);
    for (const args of [['--force', '--sign', 'real-certificate', '/app'],
        ['--force', '--sign', '-', '--timestamp', '/app'], ['--force', '--deep', '--sign', '-', '/app']]) {
        assert.throws(() => allowPreparationCommand('/usr/bin/codesign', args));
    }
});

test('invalid preparation and rehearsal finalization stop before commands or output', t => {
    const root = temporary(t);
    let calls = 0;
    const execute = () => { calls++; throw new Error('unexpected external call'); };
    assert.throws(() => prepare(root, { ...config(), feedURL: 'wrong' }, 'test', { execute }));
    assert.equal(calls, 0);
    const directory = runDirectory(root, 'test', { create: true });
    writeFileSync(join(directory, 'config.json'), JSON.stringify(rehearsal()));
    assert.throws(() => finalize(root, 'test', { run: execute }));
    assert.throws(() => finalize(root, 'test', { approved: true, run: execute }), /rehearsal cannot/);
    assert.equal(calls, 0);
    assert.deepEqual(readdirSync(directory), ['config.json']);
});

test('explicit inside-out signing has no deep signing or security-bypass entitlements', () => {
    const identifiers = Object.fromEntries(signTargets.map((target, i) => [target, i === 5 ? helperID : `nested.${i}`]));
    const commands = signingCommands('/owned/app', config(), identifiers);
    assert.deepEqual(commands.map(c => c.args.at(-1)), signTargets.map(target => join('/owned/app', target)));
    assert.ok(commands.every(c => c.args.includes('--timestamp') && c.args.includes('runtime') && !c.args.includes('--deep')));
    assert.throws(() => signingCommands('/owned/app', rehearsal(), identifiers));
    for (const target of signTargets) {
        assert.throws(() => verifyEntitlements(target, { 'com.apple.security.cs.disable-library-validation': true }));
        assert.throws(() => verifyEntitlements(target, { 'com.apple.security.get-task-allow': true }));
    }
});

test('release signing checks reject wrong identity, Team ID, public key, missing timestamp and ad-hoc', () => {
    const c = config(), identity = `${c.signingIdentity} "Developer ID Application: Test (${c.teamID})"`;
    verifySigningInputs(c, identity, c.publicKey, 'different-public-key');
    assert.throws(() => verifySigningInputs(c, identity.replace(c.teamID, 'OTHERTEAM1'), c.publicKey, 'different'));
    assert.throws(() => verifySigningInputs(c, identity, rehearsalKey, 'different'));
    assert.throws(() => verifySigningInputs(c, identity, c.publicKey, c.publicKey));
    const signature = `Identifier=${helperID}\nTeamIdentifier=${c.teamID}\nAuthority=Developer ID Application: Test\nTimestamp=Oct 7, 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n`;
    parseSignature(signature, { identifier: helperID, teamID: c.teamID });
    for (const bad of [signature.replace(c.teamID, 'OTHERTEAM1'), signature.replace('runtime', 'adhoc'),
        signature.replace('Timestamp=Oct 7, 2026\n', ''), signature + 'Signature=adhoc\n']) {
        assert.throws(() => parseSignature(bad, { identifier: helperID, teamID: c.teamID }));
    }
    const disk = signature.replace(`Identifier=${helperID}`, `Identifier=${helperID}.distribution`);
    verifyDiskSignature(disk, c.teamID);
    assert.throws(() => verifyDiskSignature(disk, 'OTHERTEAM1'));
    assert.throws(() => verifyDiskSignature(disk + 'Signature=adhoc\n', c.teamID));
});

test('post-sign comparison permits specific seals, not altered code, resources, permissions or links', () => {
    const f = 'Contents/Frameworks/Sparkle.framework/Versions/B';
    const seals = ['Contents/_CodeSignature/CodeResources', `${f}/_CodeSignature/CodeResources`,
        `${f}/Updater.app/Contents/_CodeSignature/CodeResources`,
        ...['Installer', 'Downloader'].map(n => `${f}/XPCServices/${n}.xpc/Contents/_CodeSignature/CodeResources`)];
    const before = [{ path: 'Contents/MacOS/OMGSkillsHelper', mode: 0o755, sha256: 'code' },
        { path: `${f}/Resources/Info.plist`, mode: 0o644, sha256: 'resource' },
        ...seals.map(path => ({ path, mode: 0o644, sha256: 'old-seal' }))];
    const after = before.map(e => ({ ...e, sha256: seals.includes(e.path) ? 'new-seal' : e.sha256 }));
    verifyManifestChange(before, after);
    verifyManifestChange(before, [...after, { path: 'Contents/CodeResources', mode: 0o644, sha256: 'ticket' }], { stapled: true });
    for (const changed of [[{ ...after[0], sha256: 'changed' }, ...after.slice(1)],
        [{ ...after[0], mode: 0o777 }, ...after.slice(1)], [...after, { path: 'unexpected', sha256: 'bytes' }]]) {
        assert.throws(() => verifyManifestChange(before, changed));
    }
});

function notaryFixture(t, { status = 'Accepted', failAt } = {}) {
    const root = temporary(t), archive = join(root, 'app.zip'), log = join(root, 'notary.json');
    writeFileSync(archive, 'synthetic archive');
    const id = '11111111-1111-4111-8111-111111111111', calls = [];
    const run = (command, args) => {
        calls.push({ command, args });
        assert.equal(command, '/usr/bin/xcrun');
        assert.ok(args.includes('--keychain-profile') && args.includes('helper-notary'));
        if (args[1] === failAt) throw new Error('injected interruption');
        if (args[1] === 'submit') return JSON.stringify({ id });
        if (args[1] === 'wait') return JSON.stringify({ id, status });
        if (args[1] === 'log') return JSON.stringify({ jobId: id, status, sha256: hash(readFileSync(archive)) });
        assert.fail('unexpected command');
    };
    const journal = new FinalizationJournal(join(root, 'journal.json'), 'configuration-hash', run);
    return { root, archive, log, id, calls, journal, run };
}

test('notarization timeout resumes recorded ID without another upload', t => {
    const f = notaryFixture(t, { failAt: 'wait' });
    assert.throws(() => f.journal.notarize('app', f.archive, 'helper-notary', f.log));
    assert.equal(readJSON(f.journal.path).submissions.app.id, f.id);
    const resumed = new FinalizationJournal(f.journal.path, 'configuration-hash', (command, args) => {
        assert.notEqual(args[1], 'submit');
        if (args[1] === 'wait') return JSON.stringify({ id: f.id, status: 'Accepted' });
        return f.run(command, args);
    });
    assert.equal(resumed.notarize('app', f.archive, 'helper-notary', f.log).status, 'accepted');
    assert.equal(f.calls.filter(c => c.args[1] === 'submit').length, 1);
});

test('unknown submission outcome and rejection fail closed on retry', t => {
    for (const options of [{ failAt: 'submit' }, { status: 'Invalid' }]) {
        const f = notaryFixture(t, options);
        assert.throws(() => f.journal.notarize('app', f.archive, 'helper-notary', f.log));
        const count = f.calls.length;
        assert.throws(() => f.journal.notarize('app', f.archive, 'helper-notary', f.log));
        assert.equal(f.calls.length, count);
        assert.ok(!readdirSync(f.root).includes('ready.json'));
    }
});

test('changed submitted bytes or configuration cannot resume', t => {
    const f = notaryFixture(t, { failAt: 'wait' });
    assert.throws(() => f.journal.notarize('app', f.archive, 'helper-notary', f.log));
    writeFileSync(f.archive, 'changed');
    const count = f.calls.length;
    assert.throws(() => f.journal.notarize('app', f.archive, 'helper-notary', f.log));
    assert.equal(f.calls.length, count);
    assert.throws(() => new FinalizationJournal(f.journal.path, 'different-configuration', f.run));
});

test('sign, verify, staple, packaging and feed interruption never reach a ready receipt', t => {
    for (const failed of ['sign', 'verify', 'staple', 'package', 'feed']) {
        const f = notaryFixture(t), stages = ['sign', 'verify', 'staple', 'package', 'feed', 'ready'];
        assert.throws(() => {
            for (const stage of stages) f.journal.step(stage, () => {
                if (stage === failed) throw new Error('injected failure');
                if (stage === 'ready') writeFileSync(join(f.root, 'ready.json'), '{}');
                return { verified: true };
            });
        });
        assert.ok(!readdirSync(f.root).includes('ready.json'));
        assert.throws(() => f.journal.step(failed, () => assert.fail('must not retry uncertain stage')));
        const first = stages[0];
        if (first !== failed) f.journal.step(first, () => assert.fail('must not rerun completed stage'));
    }
});

// Synthetic filesystem + injected external commands exercise the real finalize orchestration.
// Bundle verification itself is tested separately; no credentials or Apple tools are used here.
function finalizationFixture(t, fault) {
    const root = temporary(t), c = config(), calls = [], requests = new Map();
    const json = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
    const directory = runDirectory(root, 'fixture', { create: true });
    json(join(directory, 'config.json'), c);
    json(join(root, 'menubar/Info.plist'), { SUPublicEDKey: 'separate-mac-key' });
    const packager = {};
    for (const file of packagerFiles) {
        for (const base of [root, join(directory, 'source')]) json(join(base, helperPath, file), 'fake-packager');
        packager[file] = fileSHA(join(root, helperPath, file));
    }
    const tools = {};
    for (const name of ['generate_keys', 'sign_update', 'generate_appcast']) {
        const file = join(directory, 'swift-build/artifacts/sparkle/Sparkle/bin', name);
        json(file, 'fake-tool'); tools[name] = fileSHA(file);
    }
    const versions = c.versions.map(v => {
        const app = join(directory, `build-${v.build}/OMGSkills Helper.app`);
        json(join(app, 'Contents/Info.plist'), releasePlist(dormant(), c, v));
        json(join(app, 'Contents/MacOS/OMGSkillsHelper'), 'synthetic-executable');
        const baseline = { raw: bundleManifest(app), payload: bundleManifest(app),
            identifiers: Object.fromEntries(signTargets.map((target, i) => [target, i === 5 ? helperID : `nested.${i}`])) };
        const file = join(directory, `build-${v.build}/prepared-manifest.json`);
        json(file, baseline);
        return { ...v, manifestSHA256: fileSHA(file) };
    });
    json(join(directory, 'source-manifest.json'), []);
    json(join(directory, 'prepared.json'), { schema: 1, sourceCommit: c.sourceCommit, profile: 'release',
        status: 'prepared-not-for-distribution', committedPackager: true,
        configSHA256: fileSHA(join(directory, 'config.json')), sourceManifestSHA256: fileSHA(join(directory, 'source-manifest.json')),
        packager, sparkle: { tools }, versions });
    let pending = fault === 'timeout';
    const run = (command, args, options = {}) => {
        calls.push({ command, args });
        const tool = basename(command);
        if (tool === 'security') return `${c.signingIdentity} "Developer ID Application: Test (${c.teamID})"`;
        if (tool === 'generate_keys') {
            assert.deepEqual(args, ['--account', helperID, '-p']);
            return c.publicKey;
        }
        if (tool === 'plutil') return options.input ?? readFileSync(args.at(-1), 'utf8');
        if (tool === 'codesign') {
            if (args.includes('--display') && args.at(-1).endsWith('.dmg')) {
                return `Identifier=${helperID}.distribution\nAuthority=Developer ID Application: Test\nTeamIdentifier=${fault === 'disk-team' ? 'OTHERTEAM1' : c.teamID}\nTimestamp=Oct 7, 2026\n`;
            }
            if (args.includes('--entitlements') && args.includes('--display')) {
                return JSON.stringify(args.at(-1).endsWith('/Autoupdate')
                    ? { 'com.apple.application-identifier': 'org.sparkle-project.Sparkle.Autoupdate' } : {});
            }
            if (fault === 'sign' && args.includes('--sign')) throw new Error('sign failed');
            return '';
        }
        if (tool === 'ditto') {
            if (args.includes('-c')) writeFileSync(args.at(-1), `archive for ${args.at(-2)}`);
            else cpSync(args[0], args[1], { recursive: true });
            return '';
        }
        if (tool === 'xcrun') {
            if (args[1] === 'history') {
                if (fault === 'notary-profile') throw new Error('notary credentials unavailable');
                return JSON.stringify({ history: [] });
            }
            if (args[0] === 'stapler') {
                if (fault === 'staple') throw new Error('staple failed');
                return '';
            }
            if (args[1] === 'submit') {
                const id = `11111111-1111-4111-8111-${String(requests.size + 1).padStart(12, '0')}`;
                requests.set(id, fileSHA(args[2]));
                if (fault === 'unknown-submit') throw new Error('lost submission response');
                return JSON.stringify({ id });
            }
            if (args[1] === 'wait') {
                if (pending) { pending = false; throw new Error('timeout'); }
                return JSON.stringify({ id: args[2], status: fault === 'reject' ? 'Invalid' : 'Accepted' });
            }
            return JSON.stringify({ jobId: args[2], sha256: requests.get(args[2]), status: fault === 'reject' ? 'Invalid' : 'Accepted' });
        }
        if (tool === 'hdiutil') {
            if (fault === 'package' && args[0] === 'create') throw new Error('packaging interrupted');
            if (args[0] === 'create') writeFileSync(args.at(-1), `synthetic image ${args.at(-1)}`);
            if (args[0] === 'attach') {
                const mount = args[args.indexOf('-mountpoint') + 1];
                cpSync(join(dirname(args.at(-1)), 'OMGSkills Helper.app'), join(mount, 'OMGSkills Helper.app'), { recursive: true });
                if (fault === 'mount') throw new Error('attach partially succeeded');
            }
            return '';
        }
        if (tool === 'spctl') return '';
        if (tool === 'generate_appcast') {
            assert.deepEqual(args.slice(0, 6), ['--account', helperID, '--maximum-deltas', '0', '--download-url-prefix', downloadPrefix]);
            writeFileSync(join(args.at(-1), 'appcast.xml'), '<rss><channel/></rss>');
            return '';
        }
        if (tool === 'sign_update') {
            assert.deepEqual(args.slice(0, 3), ['--account', helperID, '--verify']);
            if (fault === 'feed-signature') throw new Error('bad signature');
            return '';
        }
        if (tool === 'xmllint') {
            const expression = args[2];
            if (expression === 'count(/rss/channel/item)') return '2';
            if (expression.includes('deltas')) return '0';
            if (expression.startsWith('count')) return '1';
            const v = c.versions[Number(/item\[(\d+)\]/.exec(expression)[1]) - 1];
            const filename = `OMGSkills-Helper-${v.version}-${v.build}-arm64.dmg`;
            const field = /local-name\(\)="(\w+)"/.exec(expression)[1];
            return { version: v.build, shortVersionString: v.version, minimumSystemVersion: '14.0', hardwareRequirements: 'arm64',
                os: '', url: fault === 'feed-url' ? 'https://wrong.example/file' : downloadPrefix + filename,
                length: String(statSync(join(directory, `build-${v.build}`, filename)).size),
                edSignature: Buffer.alloc(64, 9).toString('base64') }[field];
        }
        assert.fail(`Unexpected fake external command: ${command}`);
    };
    const verify = (app, _bin, _config, v, _run, options) => {
        if (fault === 'verify' && options.phase === 'signed') throw new Error('signature/payload verification failed');
        return readJSON(join(directory, `build-${v.build}/prepared-manifest.json`));
    };
    return { root, directory, calls, run: () => finalize(root, 'fixture', { approved: true, run, verify }) };
}

test('actual finalization orchestration writes a receipt only after every mocked stage passes', t => {
    const f = finalizationFixture(t);
    f.run();
    const receipt = readJSON(join(f.directory, 'ready.json'));
    assert.equal(receipt.status, 'verified-local-only-not-hosted');
    assert.equal(receipt.versions.length, 2);
    assert.equal(receipt.hosted, false);
    assert.equal(f.calls.filter(c => c.args[1] === 'submit').length, 4);
    assert.throws(f.run, /already finalized/);
});

test('actual finalization failure paths produce no ready receipt or public writes', t => {
    for (const fault of ['notary-profile', 'sign', 'verify', 'unknown-submit', 'reject', 'staple', 'package', 'disk-team', 'mount', 'feed-url', 'feed-signature']) {
        const f = finalizationFixture(t, fault);
        assert.throws(f.run, undefined, fault);
        assert.equal(existsSync(join(f.directory, 'ready.json')), false, fault);
        assert.equal(existsSync(join(f.root, 'site')), false);
        assert.equal(existsSync(join(f.directory, 'finalize.lock')), false);
        if (fault === 'mount') assert.ok(f.calls.some(c => c.command === '/usr/bin/hdiutil' && c.args[0] === 'detach'));
        if (fault === 'notary-profile') assert.ok(!f.calls.some(c => c.args.includes('--sign') || c.args[1] === 'submit'));
    }
});

test('actual finalization resumes a pending Apple job without re-signing or duplicate upload', t => {
    const f = finalizationFixture(t, 'timeout');
    assert.throws(f.run, /timeout/);
    assert.equal(existsSync(join(f.directory, 'ready.json')), false);
    const priorSignCalls = f.calls.filter(c => c.command === '/usr/bin/codesign' && c.args.includes('--sign')).length;
    assert.equal(priorSignCalls, 6);
    f.run();
    assert.equal(f.calls.filter(c => c.args[1] === 'submit').length, 4);
    assert.equal(f.calls.filter(c => c.command === '/usr/bin/codesign' && c.args.includes('--sign')).length, 14);
    assert.ok(existsSync(join(f.directory, 'ready.json')));
});
