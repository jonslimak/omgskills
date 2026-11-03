import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyConnectedFeed, verifyConnectedFeedSignature } from './connected-feed-signature.mjs';

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
