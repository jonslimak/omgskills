import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../site/connect-stripe-to-claude/index.html', import.meta.url), 'utf8');
const skills = [
  ['ai', 'stripe-best-practices', 'agent-toolkit/stripe-best-practices'],
  ['ai', 'connect-recommend', 'ai/connect-recommend'],
  ['ai', 'upgrade-stripe', 'agent-toolkit/upgrade-stripe'],
  ['link-cli', 'create-payment-credential', 'link-cli/create-payment-credential'],
  ['purl', 'pay-for-http-request', 'purl/pay-for-http-request'],
];

test('all five skills have canonical links and persistent installer commands', () => {
  assert.equal([...html.matchAll(/data-cmd="/g)].length, 5);
  for (const [repo, skill, path] of skills) {
    assert.ok(html.includes(`href="/skills/stripe/${path}/"`));
    assert.ok(html.includes(`data-cmd="npx skills add stripe/${repo} --skill ${skill} --agent claude-code --global"`));
    assert.ok(html.includes(`data-humblytics="Stripe Guide Copy ${skill}"`));
  }
  assert.ok(!html.includes('git clone'));
  assert.ok(!html.includes('/tmp/'));
});

test('analytics and direct download remain available', () => {
  assert.equal(html.split('https://app.humblytics.com/hmbl.min.js?id=a156a68').length - 1, 1);
  assert.match(html, /href="\/downloads\/omgskills-mac.dmg" data-humblytics="Stripe Guide Download Mac DMG"/);
});

test('structured data and sitemap use production canonical URL', () => {
  const data = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.equal(data.length, 2);
  assert.equal(data[0].embedUrl, 'https://www.youtube-nocookie.com/embed/x92YhjmZA_Q');
  assert.equal(data[1].url, 'https://omgskills.com/connect-stripe-to-claude/');
  const builder = readFileSync(new URL('./build-web-library.mjs', import.meta.url), 'utf8');
  assert.ok(builder.includes('/connect-stripe-to-claude/'));
});

test('copy buttons copy their own command and restore their label', async () => {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const commands = [...html.matchAll(/data-cmd="([^"]+)"/g)].map(match => match[1]);
  for (const command of commands) {
    let listener;
    let copied;
    let reset;
    const label = { textContent: 'Copy install command' };
    const button = {
      dataset: { cmd: command },
      querySelector: () => label,
      classList: { add() {}, remove() {} },
      addEventListener: (_, callback) => { listener = callback; },
    };
    vm.runInNewContext(script, {
      document: { querySelectorAll: () => [button] },
      navigator: { clipboard: { writeText: async value => { copied = value; } } },
      setTimeout: callback => { reset = callback; },
    });
    await listener();
    assert.equal(copied, command);
    assert.equal(label.textContent, 'Copied');
    reset();
    assert.equal(label.textContent, 'Copy install command');
  }
});
