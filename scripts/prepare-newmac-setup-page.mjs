#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dmg = resolve(process.argv[2] ?? 'missing');
assert.equal(basename(dmg), 'OMGSkills-Setup-Test-0.1.0-arm64.dmg');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
run('/usr/bin/codesign', ['--verify', '--strict', dmg]);
const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', dmg], { encoding: 'utf8' });
assert.equal(signature.status, 0);
assert.match(signature.stderr, /^TeamIdentifier=S4R7UHY755$/m);
assert.match(signature.stderr, /^Identifier=com\.jonslimak\.omgskills\.setuptest\.distribution$/m);
assert.match(signature.stderr, /^Authority=Developer ID Application: /m);
assert.match(signature.stderr, /^Timestamp=(?!none$).+$/m);
run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
const parent = join(root, 'menubar/.build/setup-test-hosting');
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, 'site-'));
mkdirSync(join(output, 'app/preview/unified'), { recursive: true });
const source = join(root, 'experiments/setup-test-web');
cpSync(join(source, 'index.html'), join(output, 'app/preview/unified/index.html'));
cpSync(join(source, 'test.css'), join(output, 'test.css'));
cpSync(dmg, join(output, basename(dmg)), { errorOnExist: true, force: false });
await build({ entryPoints: [join(source, 'main.ts')], bundle: true, format: 'esm', target: 'es2022',
  outfile: join(output, 'test.js'), define: { DOWNLOAD_SHA256: JSON.stringify(sha256) }, minify: true });
writeFileSync(join(output, '_redirects'), '/ /app/preview/unified/ 302\n/mcp https://omgskills.com/mcp 200\n');
writeFileSync(join(output, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n  Content-Security-Policy: default-src \'self\'; img-src https://github.com https://avatars.githubusercontent.com; script-src \'self\'; style-src \'self\'; connect-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'\n');
writeFileSync(join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
writeFileSync(join(output, `${basename(dmg)}.sha256`), `${sha256}  ${basename(dmg)}\n`);
console.log(JSON.stringify({ stage: 'isolated-test-page-prepared-not-deployed', output, dmgSHA256: sha256 }, null, 2));
