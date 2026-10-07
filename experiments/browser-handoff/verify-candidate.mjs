import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = ['HandoffCore', 'HandoffUI', 'OMGSkillsHelper'].sort();
const forbidden = /HandoffTestSupport|InstallFixtures|DiscoveryFixture|FixtureInstallService|InstallLaunchMode|InstallHarness|OMGSKILLS_H1[0-9_]|omgskills-helper-test|omgskills-h13-check/;

export function verifyGraph(graph) {
    assert.deepEqual(graph.dependencies, [], 'Unexpected package dependency');
    assert.deepEqual(graph.products.find(p => p.name === 'OMGSkillsHelper')?.targets, ['OMGSkillsHelper']);
    const seen = new Set();
    function visit(name) {
        if (seen.has(name)) return;
        assert.ok(modules.includes(name), `Unexpected production dependency: ${name}`);
        seen.add(name);
        const target = graph.targets.find(t => t.name === name);
        assert.ok(target, `Missing target: ${name}`);
        assert.equal((target.product_dependencies ?? []).length, 0);
        assert.ok(target.sources.length > 0 && !forbidden.test(target.sources.join('\n')));
        for (const dependency of target.target_dependencies ?? []) visit(dependency);
    }
    visit('OMGSkillsHelper');
    assert.deepEqual([...seen].sort(), modules);
}

export function verifyPlist(plist) {
    const expected = {
        CFBundleExecutable: 'OMGSkillsHelper', CFBundleIdentifier: 'com.omgskills.helper',
        CFBundleName: 'OMGSkills Helper', CFBundlePackageType: 'APPL',
        CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1',
        LSMinimumSystemVersion: '14.0', LSMultipleInstancesProhibited: true,
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(plist[key], value, key);
    assert.deepEqual(plist.CFBundleURLTypes, [{
        CFBundleURLName: 'com.omgskills.helper', CFBundleURLSchemes: ['omgskills-helper'],
    }]);
    assert.ok(!Object.keys(plist).some(key => key.startsWith('SU') || key === 'LSUIElement'));
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

export function verifyInventory(files) {
    assert.deepEqual(files.sort(), [
        'Contents/Info.plist', 'Contents/MacOS/OMGSkillsHelper', 'Contents/_CodeSignature/CodeResources',
    ].sort(), 'Unexpected app bundle contents');
}

function inventory(root, relative = '') {
    return readdirSync(join(root, relative)).flatMap(name => {
        const path = join(relative, name);
        const stat = lstatSync(join(root, path));
        assert.ok(!stat.isSymbolicLink(), `Unexpected bundle symlink: ${path}`);
        if (stat.isDirectory()) return inventory(root, path);
        assert.ok(stat.isFile(), `Unexpected bundle entry: ${path}`);
        return [path];
    });
}

function command(name, args) { return execFileSync(name, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }

function main([mode, path, bin]) {
    if (mode === 'graph') {
        verifyGraph(JSON.parse(readFileSync(path, 'utf8')));
        console.log('Production graph: HandoffCore + HandoffUI + OMGSkillsHelper only.');
        return;
    }
    assert.equal(mode, 'bundle', 'Expected graph or bundle verification mode');
    const executable = join(path, 'Contents/MacOS/OMGSkillsHelper');
    const plist = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents/Info.plist')]));
    verifyPlist(plist);
    verifyInventory(inventory(path));
    verifyLinkInputs(readFileSync(join(bin, 'OMGSkillsHelper.product/Objects.LinkFileList'), 'utf8'), bin);
    command('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path]);
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
        assert.match(line.trim(), /^(\/System\/Library\/|\/usr\/lib\/)/, 'Non-system dependency');
    }
    const architectures = command('/usr/bin/lipo', ['-archs', executable]).trim();
    assert.equal(architectures, command('/usr/bin/uname', ['-m']).trim(), 'Native architecture only in H1.4A');
    const hash = createHash('sha256').update(readFileSync(executable)).digest('hex');
    console.log(JSON.stringify({ bundleID: plist.CFBundleIdentifier, version: plist.CFBundleShortVersionString,
        build: plist.CFBundleVersion, architectures, executableSHA256: hash,
        signing: 'local ad-hoc only; no distribution claim' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
