import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInputs } from './prepare-newmac-f1.mjs';

test('assembler refuses release builds and non-local websites', () => {
  const root = mkdtempSync(join(tmpdir(), 'f1-assembly-test-'));
  try {
    for (const mode of ['debug', 'release']) {
      mkdirSync(join(root, mode, 'Sparkle.framework'), { recursive: true });
      writeFileSync(join(root, mode, 'omgskills'), 'test');
    }
    assert.throws(() => validateInputs(join(root, 'release'), 'http://localhost:5197/'));
    for (const website of ['https://omgskills.com/app/', 'http://user@localhost:5197/', 'http://localhost/']) {
      assert.throws(() => validateInputs(join(root, 'debug'), website));
    }
    assert.equal(validateInputs(join(root, 'debug'), 'http://localhost:5197/').website, 'http://localhost:5197/');
  } finally { rmSync(root, { recursive: true }); }
});

test('test bundle has its own identity and contains no update feed', () => {
  const source = readFileSync(new URL('./prepare-newmac-f1.mjs', import.meta.url), 'utf8');
  assert.match(source, /com\.jonslimak\.omgskills\.f1/);
  assert.match(source, /CFBundleURLSchemes: \['omgskills-f1'\]/);
  assert.match(source, /join\(config\.bin, 'f1-apps', basename\(root\), 'OMGSkills F1 Test\.app'\)/);
  assert.match(source, /lsregister', \['-f', app\]/);
  assert.doesNotMatch(source, /SUFeedURL|SUPublicEDKey|\/Applications\/|release-mac\.sh/);
});
