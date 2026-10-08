import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderHomeContent, replaceHomeContent, refreshHomePreview, skillLink } from './home-preview-content.mjs';

const ids = ['the-goat-list', 'elite-ui-design', 'build-ios-apps', 'starter-pack', 'design-essentials', 'video-motion-graphics'];
const collections = ids.map(id => ({id, type: 'topic', title: id, subtitle: 'Useful skills', featuredSkillIds: ['author/repo:skill']}));
const data = {generatedAt: '2026-10-08T13:00:00Z', topSkills: Array.from({length: 12}, (_, i) => ({id: `author/repo:skill-${i}`, name: `Skill ${i}`, authorHandle: 'author', installs: i * 1000}))};
const template = ['suggestions', 'collections', 'rankings'].map(name => `<!-- home:${name}:start -->old<!-- home:${name}:end -->`).join('\n');

test('renders six real collection destinations and at most ten ranked skills', () => {
  const sections = renderHomeContent(collections, data);
  assert.equal((sections.collections.match(/class="collection"/g) || []).length, 6);
  assert.equal((sections.rankings.match(/class="rank-row"/g) || []).length, 10);
  assert.match(sections.rankings, /2026-10-08/);
  assert.match(sections.rankings, /1000 reported installs/);
  assert.match(sections.collections, /\/collections\/build-ios-apps\//);
  assert.match(sections.suggestions, /aria-hidden="true" inert/);
  assert.equal(skillLink('author/repo:path/skill'), '/app/?view=discover&skill=catalog%3Aauthor%2Frepo%3Apath%2Fskill');
});

test('escapes source copy and rejects invalid ranking data', () => {
  const altered = structuredClone(data);
  altered.topSkills[0].name = '<script>alert("x")</script>';
  const output = renderHomeContent(collections, altered);
  assert.ok(!output.rankings.includes('<script>'));
  assert.match(output.rankings, /&lt;script&gt;/);
  altered.topSkills[0].installs = 'bad';
  assert.throws(() => renderHomeContent(collections, altered));
  assert.throws(() => renderHomeContent([], data));
});

test('marker refresh is repeatable and refuses missing or duplicate markers', () => {
  const sections = renderHomeContent(collections, data);
  const once = replaceHomeContent(template, sections);
  assert.equal(replaceHomeContent(once, sections), once);
  assert.throws(() => replaceHomeContent('', sections));
  assert.throws(() => replaceHomeContent(template + '<!-- home:rankings:start -->', sections));
});

test('resolves the manifest and only writes the new home page', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'home-preview-test-'));
  try {
    await mkdir(path.join(dir, 'data/v2'), {recursive: true});
    await mkdir(path.join(dir, 'home'));
    await writeFile(path.join(dir, 'index.html'), 'EXISTING HOMEPAGE');
    await writeFile(path.join(dir, 'home/index.html'), template);
    const manifest = {collections: {path: 'collections-abc.json'}, leaderboardViewData: {path: 'leaderboard-view-data-123abc.json'}};
    await writeFile(path.join(dir, 'data/v2/manifest.json'), JSON.stringify(manifest));
    await writeFile(path.join(dir, 'data/v2/collections-abc.json'), JSON.stringify({collections}));
    await writeFile(path.join(dir, 'data/v2/leaderboard-view-data-123abc.json'), JSON.stringify(data));
    await refreshHomePreview({siteDir: dir});
    assert.match(await readFile(path.join(dir, 'home/index.html'), 'utf8'), /class="rank-row"/);
    assert.equal(await readFile(path.join(dir, 'index.html'), 'utf8'), 'EXISTING HOMEPAGE');
    manifest.leaderboardViewData.path = '../private.json';
    await writeFile(path.join(dir, 'data/v2/manifest.json'), JSON.stringify(manifest));
    await assert.rejects(refreshHomePreview({siteDir: dir}), /Invalid leaderboard/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('page remains isolated, unindexed, and free of prototype dependencies', async () => {
  const html = await readFile(new URL('../site/home/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../site/home/home.js', import.meta.url), 'utf8');
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.ok(!/support\.js|image-slot|<sc-if|DCLogic|\{\{/.test(html));
  assert.ok(!/fetch\(|author-leaderboards-|skills-.*\.json/.test(js));
  assert.match(html, /action="\/app\/"/);
  assert.match(html, /name="view" value="discover"/);
  assert.match(html, /name="q"/);
});
