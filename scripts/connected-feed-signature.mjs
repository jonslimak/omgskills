import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function verifyConnectedFeedSignature(feed, publicKey) {
  const bytes = Buffer.from(feed);
  const match = /<!-- sparkle-signatures:\s*edSignature:\s*([A-Za-z0-9+/=]+)\s*length:\s*(\d+)\s*-->\s*$/.exec(bytes.toString('utf8'));
  if (!match) throw new Error('Connected appcast is missing its signature trailer');
  const length = Number(match[2]);
  const key = Buffer.from(publicKey, 'base64');
  const signature = Buffer.from(match[1], 'base64');
  if (key.length !== 32 || key.toString('base64') !== publicKey || signature.length !== 64 ||
      signature.toString('base64') !== match[1] || !Number.isSafeInteger(length) || length <= 0 ||
      length !== Buffer.byteLength(bytes.toString('utf8').slice(0, match.index))) {
    throw new Error('Connected appcast has an invalid signature trailer');
  }
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]);
  if (!verify(null, bytes.subarray(0, length), createPublicKey({ key: spki, format: 'der', type: 'spki' }), signature)) {
    throw new Error('Connected appcast signature verification failed');
  }
}

export async function verifyConnectedFeed(siteDir, repoRoot) {
  const plist = await readFile(path.join(repoRoot, 'menubar/Info.plist'), 'utf8');
  const match = /<key>SUPublicEDKey<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  if (!match) throw new Error('Missing Mac update public key');
  const feed = await readFile(path.join(siteDir, 'updates/connected/appcast.xml'));
  verifyConnectedFeedSignature(feed, match[1]);
}
