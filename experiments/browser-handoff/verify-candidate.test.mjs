import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyGraph, verifyInventory, verifyLinkInputs, verifyPlist, verifyStrings } from './verify-candidate.mjs';

const modules = ['HandoffCore', 'HandoffUI', 'OMGSkillsHelper'];
const graph = () => ({ dependencies: [], products: [{ name: 'OMGSkillsHelper', targets: ['OMGSkillsHelper'] }],
    targets: modules.map(name => ({ name, sources: ['Source.swift'], target_dependencies:
        name === 'OMGSkillsHelper' ? ['HandoffCore', 'HandoffUI'] : [] })) });

test('dependency graph excludes direct and transitive test support', () => {
    verifyGraph(graph());
    for (const target of ['OMGSkillsHelper', 'HandoffCore', 'HandoffUI']) {
        const changed = graph();
        changed.targets.find(t => t.name === target).target_dependencies.push('HandoffTestSupport');
        assert.throws(() => verifyGraph(changed));
    }
    const changed = graph();
    changed.targets[0].sources.push('InstallFixtures.swift');
    assert.throws(() => verifyGraph(changed));
});

test('link map and binary reject fixtures, launch switches, test scheme and harness', () => {
    const objects = modules.map(name => `/build/release/${name}.build/Source.swift.o`).join('\n');
    verifyLinkInputs(objects, '/build/release');
    assert.throws(() => verifyLinkInputs(objects + '\n/build/release/HandoffTestSupport.build/Fixture.swift.o', '/build/release'));
    assert.throws(() => verifyLinkInputs(objects.replace('/build/release/', '/stale/release/'), '/build/release'));
    for (const text of ['InstallFixtures', 'DiscoveryFixture', 'OMGSKILLS_H13_REAL_INSTALLS',
                        'InstallLaunchMode', 'omgskills-helper-test', 'HandoffInstallHarness']) {
        assert.throws(() => verifyStrings(text));
    }
    verifyStrings('omgskills-helper com.omgskills.helper');
});

test('bundle inventory refuses extra support tools or framework contents', () => {
    const files = ['Contents/Info.plist', 'Contents/MacOS/OMGSkillsHelper', 'Contents/_CodeSignature/CodeResources'];
    verifyInventory([...files]);
    assert.throws(() => verifyInventory([...files, 'Contents/MacOS/HandoffInstallHarness']));
});

test('plist binds one standalone identity and scheme, without updater or menu-bar flags', () => {
    const plist = { CFBundleExecutable: 'OMGSkillsHelper', CFBundleIdentifier: 'com.omgskills.helper',
        CFBundleName: 'OMGSkills Helper', CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.1.0',
        CFBundleVersion: '1', LSMinimumSystemVersion: '14.0', LSMultipleInstancesProhibited: true,
        CFBundleURLTypes: [{ CFBundleURLName: 'com.omgskills.helper', CFBundleURLSchemes: ['omgskills-helper'] }] };
    verifyPlist(plist);
    assert.throws(() => verifyPlist({ ...plist, CFBundleIdentifier: 'com.omgskills.browser-handoff-test' }));
    assert.throws(() => verifyPlist({ ...plist, SUFeedURL: 'https://example.com' }));
    assert.throws(() => verifyPlist({ ...plist, CFBundleURLTypes: [] }));
});

test('normal entry point has no developer environment parser or test composition', () => {
    for (const path of ['Sources/OMGSkillsHelper/HelperApp.swift', 'Sources/HandoffCore/UserInstallService.swift']) {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        verifyStrings(source);
        assert.doesNotMatch(source, /ProcessInfo\.processInfo\.environment|getenv\(|InstallLaunchMode/);
    }
});
