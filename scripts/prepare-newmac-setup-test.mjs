#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const appName = 'OMGSkills Setup Test.app';
const executable = 'omgskills-setup-test';
const buildArgs = ['build', '--jobs', '2', '--scratch-path', '.build/setup-test', '-c', 'release', '--arch', 'arm64',
  '--disable-automatic-resolution', '-Xswiftc', '-DOMGSKILLS_SETUP_TEST'];
const bundles = ['KeyboardShortcuts_KeyboardShortcuts.bundle', 'TelemetryDeck_TelemetryDeck.bundle', 'omgskills_omgskills.bundle'];
const packagedRpath = '@executable_path/../Frameworks';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const updateFeed = 'https://omgskills-setup-test-f3b.netlify.app/updates/f3d/appcast.xml';
const updateVersions = { a: ['0.1.1', '2'], b: ['0.1.2', '3'] };
const json = value => JSON.stringify(value, null, 2) + '\n';
const run = (command, args, cwd = repository) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

export function validateWebsite(website) {
  const url = new URL(website);
  if (url.username || url.password || url.hash || url.search || /[\s\\]/.test(website)
      || !((url.protocol === 'https:' && url.origin === 'https://omgskills.com')
        || website === 'https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/'
        || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port))) {
    throw new Error('Use the OMGSkills HTTPS website or loopback HTTP with an explicit port, without credentials, query or fragment.');
  }
  return url.href;
}

export function metadata(website, update) {
  let updateMetadata = {};
  if (update !== undefined) {
    assert.deepEqual(Object.keys(update).sort(), ['publicKey', 'release'], 'Use only a test release and public key');
    assert.ok(Object.hasOwn(updateVersions, update.release), 'Use test update release a or b');
    assert.equal(typeof update.publicKey, 'string', 'A test update public key is required');
    const bytes = Buffer.from(update.publicKey, 'base64');
    assert.ok(bytes.length === 32 && bytes.some(x => x !== 0) && bytes.toString('base64') === update.publicKey,
      'Use a canonical 32-byte test Ed25519 public key');
    const [version, build] = updateVersions[update.release];
    updateMetadata = {
      CFBundleShortVersionString: version, CFBundleVersion: build,
      OMGSkillsSetupTestUpdatesEnabled: true, SUFeedURL: updateFeed, SUPublicEDKey: update.publicKey,
      SUEnableAutomaticChecks: false, SUAutomaticallyUpdate: false, SUAllowsAutomaticUpdates: false,
      SUEnableSystemProfiling: false, SUVerifyUpdateBeforeExtraction: true, SURequireSignedFeed: true,
      SUSignedFeedFailureExpirationInterval: 0,
    };
  }
  return {
    CFBundleIdentifier: 'com.jonslimak.omgskills.setuptest',
    CFBundleName: 'OMGSkills Setup Test', CFBundleDisplayName: 'OMGSkills Setup Test',
    CFBundleExecutable: executable, CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1', CFBundleIconFile: 'omgskills.icns',
    LSMinimumSystemVersion: '14.0', LSUIElement: true, LSMultipleInstancesProhibited: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'OMGSkills Setup Test', CFBundleURLSchemes: ['omgskills-setup-test'] }],
    OMGSkillsSetupTestWebsite: validateWebsite(website),
    ...updateMetadata,
  };
}

export function validateMetadata(value) {
  // The original candidate stays updater-free; upgrade candidates use one fixed test channel.
  const release = Object.keys(updateVersions).find(key => updateVersions[key][0] === value.CFBundleShortVersionString
    && updateVersions[key][1] === value.CFBundleVersion);
  const update = value.OMGSkillsSetupTestUpdatesEnabled === true ? { release, publicKey: value.SUPublicEDKey } : undefined;
  assert.deepEqual(value, metadata(value.OMGSkillsSetupTestWebsite, update), 'Unexpected setup-test metadata');
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function inventory(root) {
  const entries = [];
  function visit(path) {
    const stat = lstatSync(path);
    const name = relative(root, path).split(sep).join('/');
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (isAbsolute(target) || !inside(root, resolve(dirname(path), target)) || !inside(root, realpathSync(path))) {
        throw new Error(`Escaping symlink: ${name}`);
      }
      entries.push({ path: name, type: 'symlink', target });
    } else if (stat.isDirectory()) {
      entries.push({ path: name, type: 'directory', mode: stat.mode & 0o777 });
      for (const child of readdirSync(path).sort()) visit(join(path, child));
    } else if (stat.isFile()) {
      entries.push({ path: name, type: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: hash(readFileSync(path)) });
    } else { throw new Error(`Unsupported file: ${name}`); }
  }
  if (!lstatSync(root).isDirectory()) throw new Error('Inventory root must be a real directory');
  visit(root);
  return entries;
}

export function createOutput(root) {
  if (realpathSync(root) !== resolve(root) || !lstatSync(root).isDirectory()) {
    throw new Error('Output parent must be a canonical directory');
  }
  // Never delete or replace an earlier candidate, including after partial failures.
  return mkdtempSync(join(root, 'candidate-'));
}

function copyChecked(source, destination) {
  const before = inventory(source);
  cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  assert.deepEqual(inventory(destination), before, `Copy mismatch: ${source}`);
  return before;
}

export function readLoadCommands(text) {
  const commands = text.split(/Load command \d+\n/).slice(1);
  return {
    rpaths: commands.filter(x => /cmd LC_RPATH\n/.test(x)).map(x => x.match(/path (.+) \(offset/)[1]),
    libraries: commands.filter(x => /cmd LC_(?:LOAD|LOAD_WEAK|REEXPORT)_DYLIB\n/.test(x)).map(x => x.match(/name (.+) \(offset/)[1]),
    minimumOS: commands.find(x => /cmd LC_BUILD_VERSION\n/.test(x))?.match(/minos ([\d.]+)/)?.[1],
    platform: commands.find(x => /cmd LC_BUILD_VERSION\n/.test(x))?.match(/platform (\S+)/)?.[1],
  };
}

export function validateExecutable({ architectures, minimumOS, platform, rpaths, libraries }) {
  assert.equal(architectures.trim(), 'arm64', 'Expected arm64 executable only');
  assert.equal(minimumOS, '14.0', 'Expected macOS 14 deployment target');
  assert.ok(['1', 'MACOS'].includes(platform), 'Expected macOS executable');
  assert.ok(rpaths.includes(packagedRpath), 'Missing bundled-framework search path');
  assert.ok(rpaths.every(path => ['/usr/lib/swift', '@loader_path', packagedRpath].includes(path)), 'Unexpected machine-specific search path');
  assert.ok(libraries.includes('@rpath/Sparkle.framework/Versions/B/Sparkle'), 'Missing expected Sparkle linkage');
  assert.ok(libraries.every(path => path.startsWith('/usr/lib/') || path.startsWith('/System/Library/')
    || path === '@rpath/Sparkle.framework/Versions/B/Sparkle'), 'Unbundled executable dependency');
}

export function validateDependencyPlatform({ minimumOS, platform }) {
  const parts = minimumOS?.split('.').map(Number);
  assert.ok(['1', 'MACOS'].includes(platform), 'Expected macOS dependency');
  assert.ok(parts?.length >= 2 && parts.every(Number.isInteger)
    && (parts[0] < 14 || (parts[0] === 14 && parts.slice(1).every(x => x === 0))),
  'Dependency requires a newer or unknown macOS version');
}

function sourceSnapshot(extraFiles = []) {
  const files = ['menubar/Package.swift', 'menubar/Package.resolved', 'menubar/Assets/omgskills.icns',
    'scripts/prepare-newmac-setup-test.mjs', 'scripts/prepare-newmac-setup-test.test.mjs', ...extraFiles];
  return {
    head: run('/usr/bin/git', ['rev-parse', 'HEAD']).trim(),
    worktreeStatus: run('/usr/bin/git', ['status', '--porcelain=v1']),
    files: files.map(path => ({ path, sha256: hash(readFileSync(join(repository, path))) })),
    nativeSources: inventory(join(repository, 'menubar/Sources')),
  };
}

export function validateResourceLayout(app) {
  assert.deepEqual(readdirSync(app), ['Contents'], 'Unexpected item at app bundle root');
  for (const path of ['Contents', 'Contents/Resources', ...bundles.map(name => `Contents/Resources/${name}`)]) {
    const directory = join(app, path);
    assert.ok(lstatSync(directory).isDirectory(), `Expected a real resource directory: ${path}`);
    assert.equal(realpathSync(directory), directory, `Redirected resource directory: ${path}`);
  }
  // AppResource reads this standard location without SwiftPM's build-machine fallback.
  const markdown = join(app, 'Contents/Resources/omgskills_omgskills.bundle/Resources/marked.min.js');
  assert.ok(lstatSync(markdown).isFile() && lstatSync(markdown).size > 0, 'Missing markdown resource');
}

export function verifyPackage(app, expectedWebsite, update) {
  return inspectPackage(app, { executable, requiredSymbols: ['PublicSkillInstallWindowController'],
    validateMetadata(plist) {
      validateMetadata(plist);
      assert.deepEqual(plist, metadata(expectedWebsite, update), 'Packaged settings differ from requested candidate');
    } });
}

export function inspectPackage(app, { executable: binaryName, validateMetadata: validate,
  requiredSymbols = [], forbiddenSymbols = [] }) {
  const contents = join(app, 'Contents');
  const plist = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')]));
  validate(plist);
  const binary = join(contents, 'MacOS', binaryName);
  const load = readLoadCommands(run('/usr/bin/otool', ['-l', binary]));
  const architecture = run('/usr/bin/lipo', ['-archs', binary]).trim();
  validateExecutable({ ...load, architectures: architecture });
  assert.ok(lstatSync(binary).mode & 0o111, 'Executable permissions missing');
  const symbols = run('/usr/bin/nm', [binary]);
  for (const symbol of requiredSymbols) assert.ok(symbols.includes(symbol), `Candidate symbol missing: ${symbol}`);
  for (const symbol of forbiddenSymbols) assert.ok(!symbols.includes(symbol), `Unexpected candidate symbol: ${symbol}`);
  validateResourceLayout(app);
  const entries = inventory(app);
  assert.ok(!entries.some(x => /(?:^|\/)(?:skills\.json|sha-history\.json|.*Tests.*|.*\.xctest)(?:\/|$)/.test(x.path)), 'Catalog/test payload unexpectedly bundled');
  const binaries = [];
  for (const entry of entries.filter(x => x.type === 'file')) {
    const path = join(app, entry.path);
    const magic = readFileSync(path).subarray(0, 4).toString('hex');
    if (!['cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf'].includes(magic)) continue;
    assert.ok(run('/usr/bin/lipo', ['-archs', path]).trim().split(/\s+/).includes('arm64'), `No arm64 slice: ${entry.path}`);
    const info = readLoadCommands(run('/usr/bin/otool', ['-arch', 'arm64', '-l', path]));
    validateDependencyPlatform(info);
    for (const dependency of info.libraries) {
      if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) continue;
      const target = dependency.startsWith('@rpath/') ? join(contents, 'Frameworks', dependency.slice(7))
        : dependency.startsWith('@loader_path/') ? join(dirname(path), dependency.slice(13)) : '';
      assert.ok(target && inside(app, realpathSync(target)), `Unbundled dependency: ${entry.path}: ${dependency}`);
    }
    binaries.push({ path: entry.path, minimumOS: info.minimumOS ?? null });
  }
  return { metadata: plist, architecture, loadCommands: load, binaries, entries };
}

export function prepare(website, update) {
  return assemblePackage({ plist: metadata(website, update), buildArgs,
    buildDirectory: '.build/setup-test/arm64-apple-macosx/release', outputDirectory: 'setup-test-packages',
    appName, executable, requiredSymbols: ['PublicSkillInstallWindowController'],
    validateMetadata(plist) {
      validateMetadata(plist);
      assert.deepEqual(plist, metadata(website, update), 'Packaged settings differ from requested candidate');
    } });
}

export function assemblePackage({ plist, buildArgs: args, buildDirectory, outputDirectory,
  appName: bundleName, executable: binaryName, validateMetadata: validate,
  requiredSymbols = [], forbiddenSymbols = [], sourceFiles = [], additionalLimitations = [] }) {
  if (process.platform !== 'darwin') throw new Error('Assembly requires macOS');
  validate(plist);
  const before = sourceSnapshot(sourceFiles);
  const menubar = join(repository, 'menubar');
  execFileSync('/usr/bin/swift', args, { cwd: menubar, stdio: ['ignore', 'inherit', 'inherit'] });
  assert.deepEqual(sourceSnapshot(sourceFiles), before, 'Sources changed during build; stop and rerun');
  const bin = run('/usr/bin/swift', [...args, '--show-bin-path'], menubar).trim();
  const expectedBin = join(menubar, buildDirectory);
  assert.equal(realpathSync(bin), expectedBin, 'Unexpected build directory');
  const outputParent = join(repository, 'menubar/.build', outputDirectory);
  mkdirSync(outputParent, { recursive: true });
  const output = createOutput(outputParent);
  const source = { ...before, buildCommand: ['/usr/bin/swift', ...args], swiftVersion: run('/usr/bin/swift', ['--version']).trim() };
  writeFileSync(join(output, 'source-manifest.json'), json(source), { flag: 'wx' });
  const app = join(output, bundleName);
  const contents = join(app, 'Contents');
  for (const directory of ['MacOS', 'Resources', 'Frameworks']) mkdirSync(join(contents, directory), { recursive: true });
  const binary = join(contents, 'MacOS', binaryName);
  cpSync(join(bin, 'omgskills'), binary, { errorOnExist: true, force: false });
  const buildBinarySHA256 = hash(readFileSync(binary));
  const dependencyInputs = {};
  for (const name of bundles) {
    dependencyInputs[name] = copyChecked(join(bin, name), join(contents, 'Resources', name));
  }
  dependencyInputs['Sparkle.framework'] = copyChecked(join(bin, 'Sparkle.framework'), join(contents, 'Frameworks/Sparkle.framework'));
  cpSync(join(menubar, 'Assets/omgskills.icns'), join(contents, 'Resources/omgskills.icns'), { errorOnExist: true, force: false });
  const plistPath = join(contents, 'Info.plist');
  writeFileSync(plistPath, json(plist), { flag: 'wx' });
  run('/usr/bin/plutil', ['-convert', 'xml1', plistPath]);
  const load = readLoadCommands(run('/usr/bin/otool', ['-l', binary]));
  const removedRpaths = load.rpaths.filter(path => path.startsWith('/Applications/Xcode') && path.includes('/Toolchains/'));
  for (const path of removedRpaths) run('/usr/bin/install_name_tool', ['-delete_rpath', path, binary]);
  if (!load.rpaths.includes(packagedRpath)) run('/usr/bin/install_name_tool', ['-add_rpath', packagedRpath, binary]);
  const inspection = inspectPackage(app, { executable: binaryName, validateMetadata: validate, requiredSymbols, forbiddenSymbols });
  const artifact = { format: 1, stage: 'local-pre-signing-inspection-only', app: bundleName, distributable: false,
    ...inspection, buildBinarySHA256, packagedBinarySHA256: hash(readFileSync(binary)), removedRpaths,
    dependencyInputs, sourceManifestSHA256: hash(readFileSync(join(output, 'source-manifest.json'))),
    limitations: ['Not signed by this assembler; compiler/dependency signatures may remain and require signing after packaging.',
      'No notarization, DMG, registration, launch, installation, hosting or fresh-Mac acceptance.',
      'No runtime proof from package inspection; compiler debug/resource fallback paths are not configured destinations.',
      ...additionalLimitations] };
  writeFileSync(join(output, 'artifact-manifest.json'), json(artifact), { flag: 'wx' });
  assert.deepEqual(inventory(app), inspection.entries, 'Package changed during inspection');
  const receipt = { output, app, createdAt: new Date().toISOString(), stage: artifact.stage,
    distributable: false,
    sourceManifestSHA256: artifact.sourceManifestSHA256,
    artifactManifestSHA256: hash(readFileSync(join(output, 'artifact-manifest.json'))),
    packagedBinarySHA256: artifact.packagedBinarySHA256 };
  writeFileSync(join(output, 'receipt.json'), json(receipt), { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { website: { type: 'string' },
    'update-release': { type: 'string' }, 'update-public-key': { type: 'string' } } });
  if (!values.website) throw new Error('Use --website with the approved local preview or website URL.');
  const wantsUpdates = values['update-release'] !== undefined || values['update-public-key'] !== undefined;
  console.log(json(prepare(values.website, wantsUpdates
    ? { release: values['update-release'], publicKey: values['update-public-key'] } : undefined)));
}
