import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { homepageCollectionPaths, renderHomeContent, replaceHomeContent, refreshHomePreview, skillLink } from './home-preview-content.mjs';

const ids = ['the-goat-list', 'elite-ui-design', 'build-ios-apps', 'starter-pack', 'design-essentials', 'video-motion-graphics'];
const collections = ids.map(id => ({id, type: 'topic', title: id, subtitle: 'Useful skills', featuredSkillIds: ['author/repo:skill']}));
const data = {generatedAt: '2026-10-08T13:00:00Z', topSkills: Array.from({length: 12}, (_, i) => ({id: `author/repo:skill-${i}`, name: `Skill ${i}`, authorHandle: 'author', installs: i * 1000}))};
const template = ['suggestions', 'collections', 'rankings'].map(name => `<!-- home:${name}:start -->old<!-- home:${name}:end -->`).join('\n');

test('download continues when conversion pixels are unavailable or throw', async () => {
  const js = await readFile(new URL('../site/home/home.js', import.meta.url), 'utf8');
  const start = js.indexOf('// Same download conversion events');
  assert.ok(start >= 0);
  for (const scenario of ['normal', 'unavailable', 'twq', 'rdt', 'oaiq', 'modified', 'prevented']) {
    let click;
    const calls = [];
    const timers = [];
    const location = { href: '' };
    const link = {
      href: 'https://omgskills.com/downloads/omgskills-mac.dmg',
      addEventListener: (_, listener) => { click = listener; },
    };
    const window = {};
    for (const name of ['twq', 'rdt', 'oaiq']) {
      if (scenario === 'unavailable') continue;
      window[name] = () => {
        calls.push(name);
        if (scenario === name) throw new Error('Synthetic pixel failure');
      };
    }
    runInNewContext(js.slice(start), {
      document: { querySelectorAll: () => [link] }, window, location,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    });
    const event = {
      button: 0, metaKey: scenario === 'modified',
      defaultPrevented: scenario === 'prevented',
      preventDefault() { this.defaultPrevented = true; },
    };
    assert.doesNotThrow(() => click(event), scenario);
    if (scenario === 'modified' || scenario === 'prevented') {
      assert.equal(timers.length, 0, scenario);
      assert.deepEqual(calls, [], scenario);
      continue;
    }
    assert.equal(event.defaultPrevented, true, scenario);
    assert.equal(timers.length, 1, scenario);
    assert.equal(timers[0].delay, 150, scenario);
    assert.deepEqual(calls, scenario === 'unavailable' ? [] : ['twq', 'rdt', 'oaiq'], scenario);
    timers[0].callback();
    assert.equal(location.href, link.href, scenario);
  }
});

test('renders six real collection destinations and at most ten ranked skills', () => {
  const sections = renderHomeContent(collections, data);
  assert.equal((sections.collections.match(/class="collection"/g) || []).length, 6);
  assert.equal((sections.rankings.match(/class="rank-row"/g) || []).length, 10);
  assert.match(sections.rankings, /2026-10-08/);
  assert.match(sections.rankings, /1000 reported installs/);
  assert.match(sections.collections, /\/collections\/build-ios-apps\//);
  assert.match(sections.suggestions, /aria-hidden="true" inert/);
  assert.equal(skillLink('author/repo:path/skill'), '/app/?view=discover&skill=catalog%3Aauthor%2Frepo%3Apath%2Fskill');
  // Published static skill pages are preferred, so the homepage's links are crawlable.
  assert.equal(skillLink('author/repo:skill', {'author/repo:skill': '/skills/author/repo/skill/'}), '/skills/author/repo/skill/');
  for (const unsafe of ['https://evil.test/', '/skills/../x/', '/other/x/', '/skills/x']) {
    assert.equal(skillLink('a/b:c', {'a/b:c': unsafe}), '/app/?view=discover&skill=catalog%3Aa%2Fb%3Ac');
  }
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

test('resolves the manifest and fills the homepage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'home-preview-test-'));
  try {
    await mkdir(path.join(dir, 'data/v2'), {recursive: true});
    await writeFile(path.join(dir, 'index.html'), template);
    await writeFile(path.join(dir, 'catalog-skill-urls.json'), JSON.stringify({skills: {'author/repo:skill-0': '/skills/author/repo/skill-0/'}}));
    const manifest = {collections: {path: 'collections-abc.json'}, leaderboardViewData: {path: 'leaderboard-view-data-123abc.json'}};
    await writeFile(path.join(dir, 'data/v2/manifest.json'), JSON.stringify(manifest));
    await writeFile(path.join(dir, 'data/v2/collections-abc.json'), JSON.stringify({collections}));
    await writeFile(path.join(dir, 'data/v2/leaderboard-view-data-123abc.json'), JSON.stringify(data));
    await refreshHomePreview({siteDir: dir});
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /class="rank-row" href="\/skills\/author\/repo\/skill-0\/"/);
    assert.equal(homepageCollectionPaths(html).length, 6);
    manifest.leaderboardViewData.path = '../private.json';
    await writeFile(path.join(dir, 'data/v2/manifest.json'), JSON.stringify(manifest));
    await assert.rejects(refreshHomePreview({siteDir: dir}), /Invalid leaderboard/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('homepage is indexable and free of prototype dependencies', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../site/home/home.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/omgskills.com\/">/);
  assert.ok(!/support\.js|image-slot|<sc-if|DCLogic|\{\{/.test(html));
  assert.ok(!/fetch\(|author-leaderboards-|skills-.*\.json/.test(js));
  assert.match(html, /action="\/app\/"/);
  assert.match(html, /name="view" value="discover"/);
  assert.match(html, /name="q"/);
});

test('library links open the app and follow the theme control in the header', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(?:Skill library|Explore the library)<\/a>/g)];
  assert.equal(links.length, 4);
  for (const link of links) assert.equal(link[1], '/app/');
  assert.match(html, /<a href="\/app\/">Discover<\/a>/);
  const themeIndex = html.indexOf('id="theme-toggle"');
  const libraryIndex = html.indexOf('class="library-link"');
  assert.ok(themeIndex >= 0 && libraryIndex > themeIndex);
});

test('landing artwork matches the demo green in light and dark themes', async () => {
  const css = await readFile(new URL('../site/home/home.css', import.meta.url), 'utf8');
  assert.equal((css.match(/--green:#34c759;--on-green:#fff;/g) || []).length, 3);
  assert.doesNotMatch(css, /--green:#(?:248a3d|30d158)/);
  assert.match(css, /--tint:rgba\(52,199,89,\.22\)/);
  assert.equal((css.match(/--tint:rgba\(48,209,88,\.26\)/g) || []).length, 2);
});

test('data refresh preserves the handoff layout and static feature artwork', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const refreshed = replaceHomeContent(html, renderHomeContent(collections, data));
  const withoutGeneratedContent = value => value.replace(
    /(<!-- home:(suggestions|collections|rankings):start -->)[\s\S]*?(<!-- home:\2:end -->)/g,
    '$1$3',
  );
  assert.equal(withoutGeneratedContent(refreshed), withoutGeneratedContent(html));
  assert.match(refreshed, /Your team's skills, every agent/);
  const sectionTitles = [...refreshed.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)];
  assert.equal(sectionTitles.filter(([tag]) => !tag.includes('site-footer') && !/<h2>(Library|Developers|Company)<\/h2>/.test(tag)).length, 7);
  for (const [, title] of sectionTitles) assert.match(title, /^[A-Z]/);
  assert.match(refreshed, /<h1 id="hero-title">share skills<br>with your team<\/h1>/);
  assert.doesNotMatch(refreshed, /mac-section|Download for macOS/);
  assert.match(refreshed, /Example design team set/);
  assert.match(refreshed, /<div class="demo-footer">keep updated<span class="switch" aria-hidden="true"><\/span><\/div>/);
});
