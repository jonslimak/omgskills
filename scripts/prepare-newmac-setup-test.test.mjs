import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOutput, inventory, metadata, readLoadCommands, validateDependencyPlatform, validateExecutable, validateMetadata, validateResourceLayout, validateWebsite } from './prepare-newmac-setup-test.mjs';

const website = 'http://127.0.0.1:5198/app/preview/unified/';

function resourceFixture() {
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'setup-package-resources-')));
  for (const name of ['KeyboardShortcuts_KeyboardShortcuts', 'TelemetryDeck_TelemetryDeck', 'omgskills_omgskills']) {
    mkdirSync(join(app, `Contents/Resources/${name}.bundle/Resources`), { recursive: true });
  }
  writeFileSync(join(app, 'Contents/Resources/omgskills_omgskills.bundle/Resources/marked.min.js'), 'fixture');
  return app;
}

test('resource bundles use the standard location with no extra app-root contents', () => {
  const app = resourceFixture();
  validateResourceLayout(app);
  symlinkSync('Contents/Resources/omgskills_omgskills.bundle', join(app, 'omgskills_omgskills.bundle'));
  assert.throws(() => validateResourceLayout(app), /Unexpected item at app bundle root/);
});

test('rejects redirected resource bundles and missing or empty markdown resources', () => {
  const app = resourceFixture();
  const bundle = join(app, 'Contents/Resources/omgskills_omgskills.bundle');
  const markdown = join(bundle, 'Resources/marked.min.js');
  writeFileSync(markdown, '');
  assert.throws(() => validateResourceLayout(app), /Missing markdown resource/);
  renameSync(markdown, `${markdown}.old`);
  assert.throws(() => validateResourceLayout(app), /ENOENT/);
  renameSync(bundle, `${bundle}.old`);
  symlinkSync('omgskills_omgskills.bundle.old', bundle);
  assert.throws(() => validateResourceLayout(app), /Expected a real resource directory/);
});

test('fixed candidate metadata and portable website', () => {
  const value = metadata(website);
  validateMetadata(value);
  assert.equal(value.CFBundleIdentifier, 'com.jonslimak.omgskills.setuptest');
  assert.deepEqual(value.CFBundleURLTypes[0].CFBundleURLSchemes, ['omgskills-setup-test']);
  assert.equal(value.LSMinimumSystemVersion, '14.0');
  assert.equal(value.CFBundleShortVersionString, '0.1.0');
  assert.equal(validateWebsite('https://omgskills.com/app/'), 'https://omgskills.com/app/');
  const testWebsite = 'https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/';
  assert.equal(validateWebsite(testWebsite), testWebsite);
});

test('rejects production identity, feeds, other handlers and machine-specific configuration', () => {
  for (const changes of [
    { CFBundleIdentifier: 'com.jonslimak.omgskills' }, { CFBundleExecutable: 'omgskills' },
    { SUFeedURL: 'https://omgskills.com/appcast.xml' }, { SUPublicEDKey: 'test' },
    { OMGSkillsF1Root: '/private/tmp/test' }, { OMGSkillsF1Website: website },
    { HOME: '/Users/example' }, { destination: '/Users/example/.codex/skills' },
    { CFBundleURLTypes: [{ CFBundleURLSchemes: ['omgskills', 'omgskills-setup-test'] }] },
    { LSMinimumSystemVersion: '15.0' }, { CFBundleVersion: '2' },
  ]) assert.throws(() => validateMetadata({ ...metadata(website), ...changes }));
});

test('rejects unapproved websites and embedded auth/state', () => {
  for (const url of ['file:///Users/example', 'https://example.com/', 'http://omgskills.com/',
    'http://localhost/', 'http://user@localhost:5198/', 'http://localhost:5198/#token',
    'http://localhost:5198/?secret=test', 'https://omgskills.com.evil.test/', 'https://omgskills.com:999/app/',
    ' http://localhost:5198/', 'http://localhost:5198\\app',
    'https://omgskills-setup-test-f3b.netlify.app/other',
    'https://omgskills-setup-test-f3b.netlify.app.evil.test/app/preview/unified/',
    'http://omgskills-setup-test-f3b.netlify.app/app/preview/unified/']) {
    assert.throws(() => validateWebsite(url), url);
  }
});

test('inventories bytes, modes and safe internal symlinks', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'setup-package-inventory-')));
  mkdirSync(join(root, 'Versions'));
  writeFileSync(join(root, 'Versions/library'), 'payload', { mode: 0o755 });
  symlinkSync('Versions/library', join(root, 'library'));
  const result = inventory(root);
  assert.equal(result.find(x => x.path === 'library').target, 'Versions/library');
  assert.equal(result.find(x => x.path === 'Versions/library').mode, 0o755);
  assert.equal(result.find(x => x.path === 'Versions/library').sha256.length, 64);
  writeFileSync(join(root, 'Versions/library'), 'changed');
  assert.notDeepEqual(inventory(root), result);
});

test('rejects absolute, escaping, dangling and redirected symlinks', () => {
  for (const target of ['/tmp', '../', 'missing', 'redirect']) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'setup-package-escape-')));
    if (target === 'redirect') symlinkSync('/tmp', join(root, 'redirect'));
    symlinkSync(target, join(root, 'link'));
    assert.throws(() => inventory(root));
  }
});

test('fresh outputs preserve earlier candidates and refuse redirected parents', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'setup-package-output-')));
  const first = createOutput(root);
  writeFileSync(join(first, 'sentinel'), 'keep');
  const second = createOutput(root);
  assert.notEqual(first, second);
  assert.equal(readFileSync(join(first, 'sentinel'), 'utf8'), 'keep');
  symlinkSync(root, join(root, 'redirect'));
  assert.throws(() => createOutput(join(root, 'redirect')));
});

const validLoad = { architectures: 'arm64', minimumOS: '14.0', platform: '1',
  rpaths: ['/usr/lib/swift', '@loader_path', '@executable_path/../Frameworks'],
  libraries: ['@rpath/Sparkle.framework/Versions/B/Sparkle', '/usr/lib/libSystem.B.dylib'] };

test('rejects missing framework, host toolchain linkage, wrong architecture and minimum OS', () => {
  validateExecutable(validLoad);
  for (const changes of [{ architectures: 'x86_64' }, { architectures: 'arm64 x86_64' },
    { minimumOS: '15.0' }, { platform: '2' }, { rpaths: ['@loader_path'] },
    { rpaths: [...validLoad.rpaths, '/Applications/Xcode.app/Contents/lib'] },
    { libraries: [] }, { libraries: [...validLoad.libraries, '/opt/homebrew/lib/libextra.dylib'] }]) {
    assert.throws(() => validateExecutable({ ...validLoad, ...changes }));
  }
});

test('reads actual otool command shapes including weak linkage', () => {
  const result = readLoadCommands(`binary:\nLoad command 0\n      cmd LC_BUILD_VERSION\n platform 1\n    minos 14.0\nLoad command 1\n      cmd LC_RPATH\n path @loader_path (offset 12)\nLoad command 2\n cmd LC_LOAD_WEAK_DYLIB\n name /usr/lib/test.dylib (offset 24)\n`);
  assert.deepEqual(result, { minimumOS: '14.0', platform: '1', rpaths: ['@loader_path'], libraries: ['/usr/lib/test.dylib'] });
});

test('bundled dependencies must support macOS 14, not just the main executable', () => {
  validateDependencyPlatform({ minimumOS: '12.0', platform: '1' });
  validateDependencyPlatform({ minimumOS: '14.0', platform: 'MACOS' });
  for (const minimumOS of ['14.1', '15.0', undefined, 'invalid']) {
    assert.throws(() => validateDependencyPlatform({ minimumOS, platform: '1' }));
  }
  assert.throws(() => validateDependencyPlatform({ minimumOS: '12.0', platform: '2' }));
});

test('assembler has no sign, launch, registration, deletion or release commands', () => {
  const source = readFileSync(new URL('./prepare-newmac-setup-test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /codesign|lsregister|notarytool|hdiutil|release-mac\.sh|rmSync|unlinkSync|\/usr\/bin\/open/);
  assert.match(source, /-DOMGSKILLS_SETUP_TEST/);
  assert.match(source, /--disable-automatic-resolution/);
  assert.match(source, /local-pre-signing-inspection-only/);
});
