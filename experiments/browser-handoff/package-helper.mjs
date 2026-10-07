#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frameworkManifest, verifyDependency, verifyGraph, verifyPlist } from './verify-candidate.mjs';
import { feedURL, fileSHA, helperID, helperPath, ownedPath, packagerFiles, parseSnapshotListing, readJSON,
    rehearsalKey, releasePlist, runDirectory, sha256, validateConfig, validatorLink, validatorPath, writeJSON } from './release-contract.mjs';
import { plistJSON, verifyBundle } from './verify-release.mjs';
import { finalize } from './finalize-helper.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');

export function allowPreparationCommand(command, args) {
    const ordinary = new Set(['/usr/bin/git', '/usr/bin/swift', '/usr/bin/ditto', '/usr/bin/plutil',
        '/usr/bin/nm', '/usr/bin/strings', '/usr/bin/lipo', '/usr/bin/otool', '/usr/bin/uname', '/usr/bin/sw_vers']);
    if (command === '/usr/bin/codesign') {
        assert.ok(!args.some(arg => arg.startsWith('--timestamp')));
        if (args.includes('--sign')) {
            const expected = args.includes('--identifier')
                ? ['--force', '--sign', '-', '--identifier', 'com.omgskills.payload-comparison'] : ['--force', '--sign', '-'];
            assert.deepEqual(args.slice(0, -1), expected);
        }
        else {
            assert.ok(['--verify', '--display', '--remove-signature'].includes(args[0]));
            assert.ok(!args.includes('--deep') || args[0] === '--verify');
        }
    } else assert.ok(ordinary.has(command), `Preparation command refused: ${command}`);
}

export function commandRunner({ preparation = true, journal = [], cwd = repo, cache } = {}) {
    return (command, args, options = {}) => {
        if (preparation) allowPreparationCommand(command, args);
        journal.push({ command, args });
        const result = spawnSync(command, args, { cwd, encoding: options.binary ? null : 'utf8',
            input: options.input, maxBuffer: 128 * 1024 * 1024, timeout: 900_000,
            env: { ...process.env, ...(cache ? { CLANG_MODULE_CACHE_PATH: cache, SWIFTPM_MODULECACHE_OVERRIDE: cache } : {}) } });
        // Tool output can contain account diagnostics. Keep it out of errors and general logs.
        assert.equal(result.status, 0, `${basename(command)} failed (${result.signal ?? result.status}); no ready artifact`);
        return options.stderr ? result.stderr : result.stdout;
    };
}

export function frozenSources(root, commit, run) {
    assert.equal(run('/usr/bin/git', ['-C', root, 'rev-parse', '--verify', `${commit}^{commit}`]).trim(), commit);
    const entries = parseSnapshotListing(run('/usr/bin/git', ['-C', root, 'ls-tree', '-rz', commit, '--', helperPath, validatorPath]));
    return entries.map(entry => {
        const bytes = run('/usr/bin/git', ['-C', root, 'cat-file', 'blob', entry.oid], { binary: true });
        if (entry.path === validatorLink) {
            assert.equal(entry.mode, '120000');
            assert.equal(bytes.toString(), '../../../../menubar/Sources/omgskills/SkillPackageValidator.swift');
        }
        return { ...entry, bytes };
    });
}

export function extractSnapshot(entries, root) {
    mkdirSync(root, { mode: 0o700 });
    for (const entry of entries) {
        const output = ownedPath(root, entry.path);
        mkdirSync(dirname(output), { recursive: true });
        if (entry.mode === '120000') symlinkSync(entry.bytes.toString(), output);
        else {
            writeFileSync(output, entry.bytes, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
            chmodSync(output, entry.mode === '100755' ? 0o755 : 0o644);
        }
    }
}

export function prepare(root, c, id, { execute, packagerRoot = here } = {}) {
    validateConfig(c);
    const journal = [];
    const inspect = execute ?? commandRunner({ journal, cwd: root });
    assert.equal(inspect('/usr/bin/uname', ['-m']).trim(), 'arm64', 'C1 supports native arm64 preparation only');
    const entries = frozenSources(root, c.sourceCommit, inspect);
    const packager = Object.fromEntries(packagerFiles.map(file => [file, fileSHA(join(packagerRoot, file))]));
    const committedPackager = packagerFiles.every(file => {
        const entry = entries.find(e => e.path === `${helperPath}/${file}`);
        return entry && sha256(entry.bytes) === packager[file];
    });
    if (c.profile === 'release') assert.ok(committedPackager, 'Review/commit packaging code before preparing a signable release');
    const publicApp = plistJSON(inspect, join(root, 'menubar/Info.plist'));
    assert.notEqual(c.publicKey, publicApp.SUPublicEDKey, 'Never reuse the public Mac app update key');
    const directory = runDirectory(root, id, { create: true });
    writeJSON(join(directory, 'config.json'), c, { exclusive: true });
    writeJSON(join(directory, 'status.json'), { status: 'preparing', profile: c.profile }, { exclusive: true });
    const run = execute ?? commandRunner({ journal, cwd: root, cache: join(directory, 'module-cache') });
    try {
        const source = join(directory, 'source');
        extractSnapshot(entries, source);
        writeJSON(join(directory, 'source-manifest.json'), entries.map(({ bytes, ...entry }) => ({ ...entry, sha256: sha256(bytes) })), { exclusive: true });
        const packagePath = join(source, helperPath), buildPath = join(directory, 'swift-build');
        const graph = JSON.parse(run('/usr/bin/swift', ['package', '--package-path', packagePath, 'describe', '--type', 'json']));
        verifyGraph(graph);
        run('/usr/bin/swift', ['build', '--package-path', packagePath, '--build-path', buildPath,
            '--force-resolved-versions', '-c', 'release', '--product', 'OMGSkillsHelper', '-Xswiftc', '-warnings-as-errors']);
        const dependency = JSON.parse(run('/usr/bin/swift', ['package', '--package-path', join(buildPath, 'checkouts/Sparkle'), 'dump-package']));
        verifyDependency(readJSON(join(packagePath, 'Package.resolved')), dependency);
        const bin = run('/usr/bin/swift', ['build', '--package-path', packagePath, '--build-path', buildPath,
            '-c', 'release', '--show-bin-path']).trim();
        assert.equal(bin, join(buildPath, 'arm64-apple-macosx/release'));
        const artifact = join(buildPath, 'artifacts/sparkle/Sparkle');
        assert.deepEqual(frameworkManifest(join(bin, 'Sparkle.framework')),
            frameworkManifest(join(artifact, 'Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework')));
        const tools = Object.fromEntries(['generate_keys', 'sign_update', 'generate_appcast'].map(name => {
            const path = join(artifact, 'bin', name);
            assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
            return [name, fileSHA(path)];
        }));
        const dormant = plistJSON(run, join(packagePath, 'Helper-Info.plist'));
        verifyPlist(dormant);
        const versions = [];
        for (const version of c.versions) {
            const app = join(directory, `build-${version.build}`, 'OMGSkills Helper.app');
            mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
            mkdirSync(join(app, 'Contents/Frameworks'));
            const info = join(app, 'Contents/Info.plist');
            writeFileSync(info, JSON.stringify(releasePlist(dormant, c, version)), { flag: 'wx', mode: 0o644 });
            run('/usr/bin/plutil', ['-convert', 'xml1', info]);
            copyFileSync(join(bin, 'OMGSkillsHelper'), join(app, 'Contents/MacOS/OMGSkillsHelper'));
            run('/usr/bin/ditto', [join(bin, 'Sparkle.framework'), join(app, 'Contents/Frameworks/Sparkle.framework')]);
            assert.equal(fileSHA(join(bin, 'OMGSkillsHelper')), fileSHA(join(app, 'Contents/MacOS/OMGSkillsHelper')));
            run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
            const evidence = verifyBundle(app, bin, c, version, run, { scratch: join(directory, 'scratch') });
            writeJSON(join(directory, `build-${version.build}/prepared-manifest.json`), evidence, { exclusive: true });
            versions.push({ ...version, app: `build-${version.build}/OMGSkills Helper.app`,
                manifestSHA256: fileSHA(join(directory, `build-${version.build}/prepared-manifest.json`)) });
        }
        // SwiftPM is permitted to build, not rewrite the frozen lockfile or sources.
        for (const entry of entries.filter(e => e.mode !== '120000')) assert.equal(fileSHA(join(source, entry.path)), sha256(entry.bytes));
        const receipt = { schema: 1, status: 'prepared-not-for-distribution', profile: c.profile,
            sourceCommit: c.sourceCommit, configSHA256: fileSHA(join(directory, 'config.json')), packager, committedPackager,
            sourceManifestSHA256: fileSHA(join(directory, 'source-manifest.json')),
            swift: run('/usr/bin/swift', ['--version']).trim(), macOS: run('/usr/bin/sw_vers', ['-productVersion']).trim(),
            sparkle: { version: '2.10.0', tools }, versions,
            signing: 'ad-hoc rehearsal only', appleSubmitted: false, hosted: false, launched: false };
        writeJSON(join(directory, 'prepared.json'), receipt, { exclusive: true });
        writeJSON(join(directory, 'status.json'), { status: receipt.status, profile: c.profile });
        return directory;
    } catch (error) {
        writeJSON(join(directory, 'status.json'), { status: 'preparation-failed', profile: c.profile });
        throw error;
    } finally {
        writeJSON(join(directory, 'prepare-commands.json'), journal, { exclusive: true });
    }
}

function main(args) {
    const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'prepare';
    assert.ok(['prepare', 'finalize'].includes(mode));
    const flags = {};
    while (args.length) {
        const key = args.shift();
        assert.ok(['--run', '--source', '--config', '--rehearsal', '--approve-signing-and-apple'].includes(key) && !(key in flags));
        flags[key] = ['--rehearsal', '--approve-signing-and-apple'].includes(key) ? true : args.shift();
        assert.ok(flags[key]);
    }
    if (mode === 'finalize') {
        assert.deepEqual(Object.keys(flags).sort(), ['--approve-signing-and-apple', '--run']);
        finalize(repo, flags['--run'], { approved: true, run: commandRunner({ preparation: false }) });
        return;
    }
    assert.ok(!flags['--approve-signing-and-apple']);
    let c;
    if (flags['--rehearsal']) {
        assert.deepEqual(Object.keys(flags).sort(), ['--rehearsal', '--run', '--source']);
        c = { schema: 1, profile: 'rehearsal', sourceCommit: flags['--source'], previousRelease: null,
            versions: [{ version: '0.1.0', build: '1' }, { version: '0.1.1', build: '2' }], architecture: 'arm64',
            feedURL, publicKey: rehearsalKey, teamID: null, signingIdentity: null, sparkleAccount: helperID, notaryProfile: null };
    } else {
        assert.deepEqual(Object.keys(flags).sort(), ['--config', '--run']);
        c = readJSON(flags['--config']);
    }
    console.log(`Prepared only; do not distribute, launch or register: ${prepare(repo, c, flags['--run'])}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message.split('\n')[0]); process.exitCode = 1; }
}
