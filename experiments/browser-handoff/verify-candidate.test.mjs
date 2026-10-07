import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { frameworkManifest, verifyDependency, verifyGraph, verifyInventory, verifyLinkInputs, verifyPlist, verifyStrings } from './verify-candidate.mjs';

const modules = ['HandoffCore', 'HandoffUI', 'HelperUpdates', 'OMGSkillsHelper'];
const graph = () => ({ dependencies: [{ identity: 'sparkle', requirement: { exact: ['2.10.0'] }, type: 'sourceControl',
    url: 'https://github.com/sparkle-project/Sparkle' }], products: [{ name: 'OMGSkillsHelper', targets: ['OMGSkillsHelper'] }],
    targets: [...modules, 'OmgskillsHandoff', 'HandoffInstallHarness'].map(name => ({ name, sources: ['Source.swift'],
        product_dependencies: name === 'HelperUpdates' ? ['Sparkle'] : [], target_dependencies:
        name === 'OMGSkillsHelper' ? ['HandoffCore', 'HandoffUI', 'HelperUpdates'] : [] })) });

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
    const leaked = graph();
    leaked.targets.find(t => t.name === 'OmgskillsHandoff').target_dependencies.push('HelperUpdates');
    assert.throws(() => verifyGraph(leaked));
    const unpinned = graph();
    unpinned.dependencies[0].requirement = { range: ['2.10.0', '3.0.0'] };
    assert.throws(() => verifyGraph(unpinned));
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
    const framework = ['Versions/B/Sparkle', 'Sparkle'];
    const all = [...files, ...framework.map(path => 'Contents/Frameworks/Sparkle.framework/' + path)];
    verifyInventory([...all], framework);
    assert.throws(() => verifyInventory([...all, 'Contents/MacOS/HandoffInstallHarness'], framework));
    assert.throws(() => verifyInventory([...all, 'Contents/Frameworks/Other.framework/binary'], framework));
    assert.throws(() => verifyInventory(files, []));
});

test('plist binds identity and manual-only dormant updates without feed or key', () => {
    const plist = { CFBundleExecutable: 'OMGSkillsHelper', CFBundleIdentifier: 'com.omgskills.helper',
        CFBundleName: 'OMGSkills Helper', CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.1.0',
        CFBundleVersion: '1', LSMinimumSystemVersion: '14.0', LSMultipleInstancesProhibited: true,
        CFBundleURLTypes: [{ CFBundleURLName: 'com.omgskills.helper', CFBundleURLSchemes: ['omgskills-helper'] }],
        OMGSkillsHelperUpdatesEnabled: false, SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false,
        SUAllowsAutomaticUpdates: false, SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true,
        SURequireSignedFeed: true, SUSignedFeedFailureExpirationInterval: 0 };
    verifyPlist(plist);
    assert.throws(() => verifyPlist({ ...plist, CFBundleIdentifier: 'com.omgskills.browser-handoff-test' }));
    assert.throws(() => verifyPlist({ ...plist, SUFeedURL: 'https://example.com' }));
    assert.throws(() => verifyPlist({ ...plist, CFBundleURLTypes: [] }));
    for (const key of ['OMGSkillsHelperUpdatesEnabled', 'SUEnableAutomaticChecks', 'SUAutomaticallyUpdate', 'SUAllowsAutomaticUpdates']) {
        assert.throws(() => verifyPlist({ ...plist, [key]: true }));
    }
    assert.throws(() => verifyPlist({ ...plist, SUDefaultsDomain: 'com.omgskills.app' }));
});

test('normal entry point has no developer environment parser or test composition', () => {
    for (const path of ['Sources/OMGSkillsHelper/HelperApp.swift', 'Sources/HandoffCore/UserInstallService.swift',
                       'Sources/HelperUpdates/HelperUpdater.swift', 'Sources/HelperUpdates/HelperUpdateConfiguration.swift',
                       'Sources/HelperUpdates/SparkleUpdateDriver.swift']) {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        verifyStrings(source);
        assert.doesNotMatch(source, /ProcessInfo\.processInfo\.environment|getenv\(|InstallLaunchMode/);
    }
});

test('Sparkle source revision and binary checksum cannot drift', () => {
    const resolved = JSON.parse(readFileSync(new URL('Package.resolved', import.meta.url), 'utf8'));
    const manifest = { dependencies: [], targets: [{ name: 'Sparkle', type: 'binary',
        url: 'https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-for-Swift-Package-Manager.zip',
        checksum: '17e28312b8e18ab7cdbbe09a6fb28cc55a5479ec6c371dbc07cdecd2a14fd959' }] };
    verifyDependency(resolved, manifest);
    const changed = structuredClone(resolved); changed.pins[0].state.revision = 'wrong';
    assert.throws(() => verifyDependency(changed, manifest));
    manifest.targets[0].checksum = 'wrong';
    assert.throws(() => verifyDependency(resolved, manifest));
});

test('framework inventory permits only contained relative links and captures byte/mode changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'helper-framework-test-'));
    try {
        mkdirSync(join(root, 'Versions/B'), { recursive: true });
        writeFileSync(join(root, 'Versions/B/Sparkle'), 'synthetic bytes');
        symlinkSync('B', join(root, 'Versions/Current'));
        symlinkSync('Versions/Current/Sparkle', join(root, 'Sparkle'));
        const baseline = frameworkManifest(root);
        writeFileSync(join(root, 'Versions/B/Sparkle'), 'different bytes');
        assert.notDeepEqual(frameworkManifest(root), baseline);
        symlinkSync('../', join(root, 'escape'));
        assert.throws(() => frameworkManifest(root));
        rmSync(join(root, 'escape'));
        symlinkSync(join(root, 'Versions/B/Sparkle'), join(root, 'absolute'));
        assert.throws(() => frameworkManifest(root));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
