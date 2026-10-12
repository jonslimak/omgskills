import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const origin = 'https://omgskills-setup-test-f3b.netlify.app';
const id = 'vercel-labs/agent-skills:skills/writing-guidelines';
const compiled = await build({ entryPoints: [new URL('../experiments/setup-test-web/main.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', write: false, define: { DOWNLOAD_SHA256: JSON.stringify('a'.repeat(64)) } });
const code = compiled.outputFiles[0].text;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page({ host = origin, query = '', storage = new Map() } = {}) {
  const nodes = new Map();
  const element = () => ({ textContent: '', hidden: false, disabled: false, children: [],
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const state = { reads: 0, opens: [], available: true, changed: false };
  const location = { origin: host, pathname: '/app/preview/unified/', search: query, hash: '', assign: href => state.opens.push(href) };
  runInNewContext(code, { URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    location, history: { replaceState: (_, _title, path) => { location.search = new URL(path, host).search; } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { querySelector: node, createElement: element }, addEventListener() {},
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.params.name, 'get_skill'); assert.equal(body.params.arguments.id, id);
      state.reads++;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: {
        found: state.available, skill: state.available ? { id, name: 'writing-guidelines', author_handle: 'vercel-labs',
          description: 'Test', tags: [], github_url: state.changed ? 'https://github.com/other/source' : 'https://github.com/vercel-labs/agent-skills',
          skill_md_path: 'skills/writing-guidelines/SKILL.md' } : null,
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
  for (const options of [{ host: 'https://omgskills.com' }, { host: `${origin}.evil.test` }, { query: '?skill=other' }]) {
    const p = await page(options); assert.equal(p.state.reads, 0); assert.equal(p.node('#actions').children.length, 0);
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
