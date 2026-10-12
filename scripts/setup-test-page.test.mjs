import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const origin = 'https://omgskills-setup-test-f3b.netlify.app';
const id = 'vercel-labs/agent-skills:skills/writing-guidelines';
const humanizer = 'blader/humanizer';
const queryFor = key => `?view=discover&skill=${encodeURIComponent(`catalog:${key.startsWith('humanizer') ? humanizer : id}`)}&f2case=${key}`;
const versions = [
  ['writing-guidelines-recorded', '063bee94c3f4df8453406c830b0a7df0f2860278', 'Writing Guidelines'],
  ['humanizer-a', '29deb74c89fc12d01c6eab433252c869ce08ad7b', 'Humanizer A'],
  ['humanizer-recorded', '225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8', 'Humanizer B'],
];
const compiled = await build({ entryPoints: [new URL('../experiments/setup-test-web/main.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', write: false, define: { DOWNLOAD_SHA256: JSON.stringify('a'.repeat(64)) } });
const code = compiled.outputFiles[0].text;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page({ host = origin, query = '', storage = new Map(), available = true, changed = false, pinned = false } = {}) {
  const nodes = new Map();
  const element = () => ({ textContent: '', hidden: false, disabled: false, children: [],
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
    setAttribute(key, value) { this[key] = value; } });
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const state = { reads: 0, opens: [], available, changed, pinned };
  const expectedId = query.includes('f2case=humanizer-') ? humanizer : id;
  const location = { origin: host, pathname: '/app/preview/unified/', search: query, hash: '', assign: href => state.opens.push(href) };
  runInNewContext(code, { URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    location, history: { replaceState: (_, _title, path) => { location.search = new URL(path, host).search; } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { querySelector: node, createElement: element }, addEventListener() {},
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.params.name, 'get_skill'); assert.equal(body.params.arguments.id, expectedId);
      state.reads++;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: {
        found: state.available, skill: state.available ? { id: expectedId, name: expectedId === id ? 'writing-guidelines' : 'humanizer',
          author_handle: expectedId === id ? 'vercel-labs' : 'blader', description: 'Test', tags: [],
          github_url: state.changed ? 'https://github.com/other/source' : `https://github.com/${expectedId === id ? 'vercel-labs/agent-skills' : humanizer}`,
          skill_md_path: expectedId === id ? 'skills/writing-guidelines/SKILL.md' : 'SKILL.md',
          ...(state.pinned ? { repo_commit_sha: 'a'.repeat(40) } : {}) } : null,
      } } }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  await settle();
  return { node, state, storage, query: location.search, click: async label => {
    const button = node('#actions').children.find(item => item.textContent === label);
    assert.ok(button, `Missing ${label}`); assert.equal(button.disabled, false); button.onclick(); await settle();
  } };
}

test('host and request remain fixed; mismatches do not fetch or offer actions', async () => {
  for (const options of [{ host: 'https://omgskills.com' }, { host: `${origin}.evil.test` }, { query: '?skill=other' },
    { query: queryFor('humanizer-latest') }, { query: queryFor('seo-audit-recorded') },
    { query: queryFor('humanizer-a') + '&commit=' + 'a'.repeat(40) },
    { query: queryFor('humanizer-a') + '&f2case=humanizer-recorded' },
    { query: queryFor('humanizer-a').replace('blader', 'other') }]) {
    const p = await page(options); assert.equal(p.state.reads, 0); assert.equal(p.node('#actions').children.length, 0);
  }
});

test('three exact cases render their identity and open only their recorded versions', async () => {
  for (const [key, commit, title] of versions) {
    const p = await page({ query: queryFor(key) });
    assert.equal(p.state.opens.length, 0);
    assert.equal(p.node('#title').textContent, title);
    assert.equal(p.node('#version').textContent, commit);
    assert.deepEqual(p.node('#cases').children.map(x => x.href), versions.map(([key]) => '/app/preview/unified/' + queryFor(key)));
    await p.click('Open in OMGSkills Setup Test');
    const link = new URL(p.state.opens[0]);
    assert.equal(link.protocol, 'omgskills-setup-test:');
    assert.equal(link.searchParams.get('commit'), commit);
    assert.equal(link.searchParams.get('id'), key.startsWith('humanizer') ? humanizer : id);
    assert.equal(link.searchParams.get('agent'), 'codex');
    assert.equal(link.searchParams.has('destination'), false);
  }
});

test('A and B refresh independently without replacing the original setup intent', async () => {
  const storage = new Map([['unrelated', 'keep']]);
  const original = await page({ storage }); await original.click('Set up OMGSkills Setup Test');
  const originalKey = [...storage.keys()].find(x => x !== 'unrelated');
  const originalIntent = storage.get(originalKey);
  for (const [key, commit] of versions.slice(1)) {
    const p = await page({ storage, query: queryFor(key) });
    await p.click('Open in OMGSkills Setup Test');
    const restored = await page({ storage, query: p.query });
    await restored.click('Try opening again');
    await restored.click('Open in OMGSkills Setup Test');
    assert.equal(new URL(restored.state.opens[0]).searchParams.get('commit'), commit);
  }
  assert.equal(storage.get(originalKey), originalIntent);
  assert.equal(storage.size, 4);
  const b = await page({ storage, query: queryFor('humanizer-recorded') });
  await b.click('Cancel setup');
  assert.equal(storage.size, 3);
  assert.equal(storage.get(originalKey), originalIntent);
  const a = await page({ storage, query: queryFor('humanizer-a') });
  assert.equal(a.node('#setup').hidden, false);
});

test('a mismatched saved version is blocked rather than silently reused', async () => {
  const storage = new Map();
  const a = await page({ storage, query: queryFor('humanizer-a') });
  await a.click('Set up OMGSkills Setup Test');
  const aKey = [...storage.keys()][0];
  storage.set(aKey.replace(/humanizer-a$/, 'humanizer-recorded'), storage.get(aKey));
  const b = await page({ storage, query: queryFor('humanizer-recorded') });
  assert.match(b.node('#status').textContent, /no longer matches/);
  assert.equal(b.state.opens.length, 0);
  assert.ok(b.node('#actions').children.find(item => item.textContent === 'Try opening again').disabled);
});

test('missing, changed or newly pinned sources block initial open for every case', async () => {
  for (const [key] of versions) for (const state of [{ available: false }, { changed: true }, { pinned: true }]) {
    const p = await page({ query: queryFor(key), ...state });
    assert.equal(p.node('#actions').children.length, 0);
    assert.equal(p.state.opens.length, 0);
  }
});

test('setup survives refresh, revalidates, and uses only the exact test handler and pin', async () => {
  const p = await page(); await p.click('Set up OMGSkills Setup Test');
  assert.equal(p.node('#setup').hidden, false);
  const restored = await page({ storage: p.storage, query: p.query });
  assert.equal(restored.node('#setup').hidden, false);
  await restored.click('Try opening again'); assert.equal(restored.state.reads, 2);
  await restored.click('Open in OMGSkills Setup Test');
  const link = new URL(restored.state.opens[0]);
  assert.equal(link.protocol, 'omgskills-setup-test:');
  assert.equal(link.searchParams.get('commit'), '063bee94c3f4df8453406c830b0a7df0f2860278');
  assert.equal(link.searchParams.get('agent'), 'codex');
  assert.equal(link.searchParams.has('destination'), false);
  assert.match(restored.node('#status').textContent, /Opening requested/);
});

test('changed or missing catalog source blocks retry without a native launch', async () => {
  for (const property of ['changed', 'available']) {
    const p = await page(); await p.click('Set up OMGSkills Setup Test');
    p.state[property] = property === 'changed'; await p.click('Try opening again');
    assert.equal(p.state.opens.length, 0);
    assert.ok(p.node('#actions').children.find(item => item.textContent === 'Try opening again').disabled);
  }
});

test('cancel clears only test intent and makes no native request', async () => {
  const p = await page(); p.storage.set('unrelated', 'keep');
  await p.click('Set up OMGSkills Setup Test'); await p.click('Cancel setup');
  assert.equal(p.storage.size, 1); assert.equal(p.storage.get('unrelated'), 'keep'); assert.equal(p.state.opens.length, 0);
});
