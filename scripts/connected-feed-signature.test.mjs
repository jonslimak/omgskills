import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyConnectedFeed, verifyConnectedFeedSignature, verifyConnectedFeedUrls } from './connected-feed-signature.mjs';

test('connected feed signature is valid and rejects missing, modified, or malformed feeds', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const content = Buffer.from('<rss>fixture</rss>');
  const signature = sign(null, content, privateKey).toString('base64');
  const feed = `${content}<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${content.length}\n-->\n`;
  verifyConnectedFeedSignature(feed, key);
  for (const bad of [content, feed.replace('fixture', 'changed'), feed.replace(`length: ${content.length}`, 'length: 1'),
    feed + 'extra', feed.replace(signature, Buffer.alloc(64).toString('base64'))]) {
    assert.throws(() => verifyConnectedFeedSignature(bad, key));
  }
});

test('the production connected feed is signed by the app update key', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  await verifyConnectedFeed(`${root}/site`, root);
});

test('each release uses the URL accepted by the app and an unshadowed GitHub redirect', () => {
  const item = (version, build) => `<item><sparkle:version>${build}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><enclosure url="https://omgskills.com/updates/connected/OMGSkills-Connected-${version}-${build}-arm64.zip" sparkle:installationType="application" /></item>`;
  const redirect = (version, build) => `/updates/connected/OMGSkills-Connected-${version}-${build}-arm64.zip https://github.com/jonslimak/omgskills/releases/download/connected-v${version}/OMGSkills-Connected-${version}-${build}-arm64.zip 302`;
  const feed = `<rss>${item('0.0.31', '31')}${item('0.0.32', '32')}</rss>`;
  const rules = `${redirect('0.0.31', '31')}\n${redirect('0.0.32', '32')}\n/* /index.html 200`;
  verifyConnectedFeedUrls(feed, rules);
  assert.throws(() => verifyConnectedFeedUrls(feed.replace('https://omgskills.com/updates/connected/', 'https://github.com/'), rules), /unsupported archive URL/);
  assert.throws(() => verifyConnectedFeedUrls(feed, redirect('0.0.31', '31')), /redirect missing/);
  assert.throws(() => verifyConnectedFeedUrls(feed, `/* /index.html 200\n${rules}`), /shadowed/);
  assert.throws(() => verifyConnectedFeedUrls(feed.replace('<sparkle:version>32</sparkle:version>', '<sparkle:version>0</sparkle:version>'), rules), /invalid version/);
  assert.throws(() => verifyConnectedFeedUrls(feed.replace('sparkle:installationType="application"', 'sparkle:installationType="package"'), rules), /unsupported archive type/);
});
