import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = ['HandoffCore', 'HandoffUI', 'HelperUpdates', 'OMGSkillsHelper'].sort();
const sparkleURL = 'https://github.com/sparkle-project/Sparkle';
const sparkleVersion = '2.10.0';
const sparkleRevision = 'eef1a539a373c1f1a320624b1130fc5de7b2e100';
const sparkleChecksum = '17e28312b8e18ab7cdbbe09a6fb28cc55a5479ec6c371dbc07cdecd2a14fd959';
const frameworkPrefix = 'Contents/Frameworks/Sparkle.framework/';
const forbidden = /HandoffTestSupport|InstallFixtures|DiscoveryFixture|FixtureInstallService|InstallLaunchMode|InstallHarness|OMGSKILLS_H1[0-9_]|omgskills-helper-test|omgskills-h13-check/;

export function verifyGraph(graph) {
    assert.deepEqual(graph.dependencies, [{ identity: 'sparkle', requirement: { exact: [sparkleVersion] },
        type: 'sourceControl', url: sparkleURL }], 'Unexpected package dependency');
    assert.deepEqual(graph.products.find(p => p.name === 'OMGSkillsHelper')?.targets, ['OMGSkillsHelper']);
    const seen = new Set();
    function visit(name) {
        if (seen.has(name)) return;
        assert.ok(modules.includes(name), `Unexpected production dependency: ${name}`);
        seen.add(name);
        const target = graph.targets.find(t => t.name === name);
        assert.ok(target, `Missing target: ${name}`);
        assert.deepEqual(target.product_dependencies ?? [], name === 'HelperUpdates' ? ['Sparkle'] : []);
        assert.ok(target.sources.length > 0 && !forbidden.test(target.sources.join('\n')));
        for (const dependency of target.target_dependencies ?? []) visit(dependency);
    }
    visit('OMGSkillsHelper');
    assert.deepEqual([...seen].sort(), modules);
    const checkTest = (name, visited = new Set()) => {
        if (visited.has(name)) return;
        visited.add(name);
        assert.ok(name !== 'HelperUpdates', 'Updater leaked into test app/harness');
        const target = graph.targets.find(t => t.name === name);
        assert.ok(target);
        assert.deepEqual(target.product_dependencies ?? [], []);
        for (const dependency of target.target_dependencies ?? []) checkTest(dependency, visited);
    };
    checkTest('OmgskillsHandoff');
    checkTest('HandoffInstallHarness');
}

export function verifyDependency(resolved, manifest) {
    assert.deepEqual(resolved.pins, [{ identity: 'sparkle', kind: 'remoteSourceControl', location: sparkleURL,
        state: { revision: sparkleRevision, version: sparkleVersion } }]);
    assert.deepEqual(manifest.dependencies, []);
    assert.equal(manifest.targets.length, 1);
    const target = manifest.targets[0];
    assert.equal(target.name, 'Sparkle');
    assert.equal(target.type, 'binary');
    assert.equal(target.url, `${sparkleURL}/releases/download/${sparkleVersion}/Sparkle-for-Swift-Package-Manager.zip`);
    assert.equal(target.checksum, sparkleChecksum);
}

export function verifyPlist(plist) {
    const expected = {
        CFBundleExecutable: 'OMGSkillsHelper', CFBundleIdentifier: 'com.omgskills.helper',
        CFBundleName: 'OMGSkills Helper', CFBundlePackageType: 'APPL',
        CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1',
        LSMinimumSystemVersion: '14.0', LSMultipleInstancesProhibited: true,
        OMGSkillsHelperUpdatesEnabled: false, SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false,
        SUAllowsAutomaticUpdates: false, SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true,
        SURequireSignedFeed: true, SUSignedFeedFailureExpirationInterval: 0,
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(plist[key], value, key);
    assert.deepEqual(plist.CFBundleURLTypes, [{
        CFBundleURLName: 'com.omgskills.helper', CFBundleURLSchemes: ['omgskills-helper'],
    }]);
    assert.ok(!Object.keys(plist).some(key => (key.startsWith('SU') && !(key in expected)) || key === 'LSUIElement'));
}

export function verifyLinkInputs(input, bin) {
    const seen = new Set();
    for (const line of input.trim().split('\n')) {
        assert.ok(line.endsWith('.o') && !forbidden.test(line), 'Unexpected linked input');
        const directory = dirname(line);
        const module = basename(directory).replace(/\.build$/, '');
        assert.equal(directory, join(bin, `${module}.build`));
        assert.ok(modules.includes(module), `Unexpected linked module: ${module}`);
        seen.add(module);
    }
    assert.deepEqual([...seen].sort(), modules);
}

export function verifyStrings(text) {
    assert.ok(!forbidden.test(text), 'Test support found in production artifact');
}

export function verifyInventory(files, frameworkFiles) {
    assert.ok(frameworkFiles.length > 0, 'Sparkle framework missing');
    assert.deepEqual(files.sort(), [
        'Contents/Info.plist', 'Contents/MacOS/OMGSkillsHelper', 'Contents/_CodeSignature/CodeResources',
        ...frameworkFiles.map(file => frameworkPrefix + file),
    ].sort(), 'Unexpected app bundle contents');
}

function inventory(root, relative = '', framework = false) {
    return readdirSync(join(root, relative)).flatMap(name => {
        const path = join(relative, name);
        const stat = lstatSync(join(root, path));
        if (stat.isSymbolicLink()) {
            const frameworkRoot = framework ? root : join(root, frameworkPrefix);
            assert.ok(framework || path.startsWith(frameworkPrefix), `Unexpected bundle symlink: ${path}`);
            assert.ok(!isAbsolute(readlinkSync(join(root, path))), 'Absolute framework symlink');
            assert.ok(realpathSync(join(root, path)).startsWith(realpathSync(frameworkRoot) + sep), 'Escaping framework symlink');
            return [path];
        }
        if (stat.isDirectory()) return inventory(root, path, framework);
        assert.ok(stat.isFile(), `Unexpected bundle entry: ${path}`);
        return [path];
    });
}

export function frameworkManifest(root) {
    assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
    return inventory(root, '', true).sort().map(path => {
        const file = join(root, path), stat = lstatSync(file);
        return stat.isSymbolicLink() ? { path, link: readlinkSync(file) }
            : { path, mode: stat.mode & 0o777, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
    });
}

function command(name, args) { return execFileSync(name, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }

function main([mode, path, bin]) {
    if (mode === 'graph') {
        verifyGraph(JSON.parse(readFileSync(path, 'utf8')));
        console.log('Normal helper graph verified; Sparkle is excluded from test app/harness.');
        return;
    }
    if (mode === 'dependency') {
        verifyDependency(JSON.parse(readFileSync(path, 'utf8')), JSON.parse(readFileSync(bin, 'utf8')));
        console.log('Sparkle version, source revision and binary archive checksum are pinned.');
        return;
    }
    assert.equal(mode, 'bundle', 'Expected graph or bundle verification mode');
    const executable = join(path, 'Contents/MacOS/OMGSkillsHelper');
    const plist = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents/Info.plist')]));
    verifyPlist(plist);
    const sourceFramework = join(bin, 'Sparkle.framework'), framework = join(path, frameworkPrefix);
    const expectedFramework = frameworkManifest(sourceFramework);
    assert.deepEqual(frameworkManifest(framework), expectedFramework, 'Embedded Sparkle differs from resolved framework');
    verifyInventory(inventory(path), expectedFramework.map(entry => entry.path));
    verifyLinkInputs(readFileSync(join(bin, 'OMGSkillsHelper.product/Objects.LinkFileList'), 'utf8'), bin);
    command('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path]);
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', framework]);
    const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', path], { encoding: 'utf8' });
    assert.equal(signature.status, 0, 'Cannot inspect signature');
    assert.match(signature.stderr, /^Signature=adhoc$/m);
    assert.match(signature.stderr, /^Identifier=com\.omgskills\.helper$/m);
    verifyStrings(command('/usr/bin/nm', ['-j', executable]));
    const strings = command('/usr/bin/strings', ['-a', executable]);
    verifyStrings(strings);
    assert.ok(strings.includes('omgskills-helper') && strings.includes('com.omgskills.helper'));
    const dependencies = command('/usr/bin/otool', ['-L', executable]);
    for (const line of dependencies.trim().split('\n').slice(1)) {
        assert.match(line.trim(), /^(\/System\/Library\/|\/usr\/lib\/|@rpath\/Sparkle\.framework\/Versions\/B\/Sparkle\s)/, 'Unexpected dependency');
    }
    assert.match(command('/usr/bin/otool', ['-l', executable]), /path @executable_path\/\.\.\/Frameworks /);
    const architectures = command('/usr/bin/lipo', ['-archs', executable]).trim();
    assert.equal(architectures, command('/usr/bin/uname', ['-m']).trim(), 'Native architecture only in this candidate');
    for (const entry of expectedFramework.filter(entry => entry.sha256)) {
        const file = join(framework, entry.path);
        if (!command('/usr/bin/file', ['-b', file]).includes('Mach-O')) continue;
        assert.ok(command('/usr/bin/lipo', ['-archs', file]).trim().split(/\s+/).includes(architectures));
        for (const line of command('/usr/bin/otool', ['-L', file]).trim().split('\n').slice(1)) {
            if (!line.includes('compatibility version')) continue;
            assert.match(line.trim(), /^(\/System\/Library\/|\/usr\/lib\/|@rpath\/Sparkle\.framework\/Versions\/B\/Sparkle\s)/);
        }
    }
    const hash = createHash('sha256').update(readFileSync(executable)).digest('hex');
    console.log(JSON.stringify({ bundleID: plist.CFBundleIdentifier, version: plist.CFBundleShortVersionString,
        build: plist.CFBundleVersion, architectures, executableSHA256: hash,
        signing: 'local ad-hoc only; no distribution claim' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
