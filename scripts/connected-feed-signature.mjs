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

export function verifyConnectedFeedUrls(feed, redirects) {
  const items = [...feed.toString('utf8').matchAll(/<item\s*>([\s\S]*?)<\/item\s*>/g)];
  if (!items.length) throw new Error('Connected appcast has no update items');
  const rules = redirects.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => line.split(/\s+/));
  for (const [, item] of items) {
    const version = /<sparkle:shortVersionString>\s*([^<]+?)\s*<\/sparkle:shortVersionString>/.exec(item)?.[1];
    const build = /<sparkle:version>\s*([^<]+?)\s*<\/sparkle:version>/.exec(item)?.[1];
    const enclosures = [...item.matchAll(/<enclosure\s+[^>]*>/g)];
    const url = enclosures.length === 1 && /\burl="([^"]+)"/.exec(enclosures[0][0])?.[1];
    if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version || '') || !/^[1-9]\d{0,8}$/.test(build || '')) {
      throw new Error('Connected appcast has an invalid version or build');
    }
    const filename = `OMGSkills-Connected-${version}-${build}-arm64.zip`;
    const pathname = `/updates/connected/${filename}`;
    const target = `https://github.com/jonslimak/omgskills/releases/download/connected-v${version}/${filename}`;
    if (!/\bsparkle:installationType="application"/.test(enclosures[0]?.[0] || '') || /<sparkle:deltas\b/.test(item)) {
      throw new Error(`Connected appcast has an unsupported archive type for ${version}`);
    }
    if (url !== `https://omgskills.com${pathname}`) throw new Error(`Connected appcast has an unsupported archive URL for ${version}`);
    const rule = rules.find(([source]) => source === pathname || (source.endsWith('*') && pathname.startsWith(source.slice(0, -1))));
    if (!rule || rule[0] !== pathname || rule[1] !== target || rule[2] !== '302') {
      throw new Error(`Connected archive redirect missing or shadowed for ${version}`);
    }
  }
}

export async function verifyConnectedFeed(siteDir, repoRoot) {
  const plist = await readFile(path.join(repoRoot, 'menubar/Info.plist'), 'utf8');
  const match = /<key>SUPublicEDKey<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  if (!match) throw new Error('Missing Mac update public key');
  const feed = await readFile(path.join(siteDir, 'updates/connected/appcast.xml'));
  verifyConnectedFeedSignature(feed, match[1]);
  verifyConnectedFeedUrls(feed, await readFile(path.join(siteDir, '_redirects'), 'utf8'));
}
