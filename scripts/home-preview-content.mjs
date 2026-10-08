import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHomepageCollections } from './homepage-library-preview.mjs';

const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const compact = value => new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 1}).format(value);
const avatar = (handle, size = 72) => `https://github.com/${encodeURIComponent(handle)}.png?size=${size}`;
const img = handle => `<img class="avatar" src="${avatar(handle)}" alt="" width="36" height="36" loading="lazy" decoding="async">`;
const topicOrder = ['the-goat-list', 'elite-ui-design', 'build-ios-apps', 'starter-pack', 'design-essentials', 'video-motion-graphics'];

export function skillLink(id) {
  return `/app/?view=discover&skill=${encodeURIComponent(`catalog:${id}`)}`;
}

export function renderHomeContent(collections, data) {
  if (!Array.isArray(collections) || !Array.isArray(data.topSkills) || !data.topSkills.length ||
      !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Missing home preview content');
  const topics = topicOrder.map(id => collections.find(row => row.type === 'topic' && row.id === id));
  if (topics.some(topic => !topic)) throw new Error('Missing featured home preview collection');
  const rows = data.topSkills.slice(0, 10);
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name ||
        typeof row.authorHandle !== 'string' || !row.authorHandle || !Number.isFinite(row.installs) || row.installs < 0) {
      throw new Error('Invalid home preview ranking row');
    }
  }
  const date = new Date(data.generatedAt).toISOString().slice(0, 10);
  const rankings = `<ol class="ranking">${rows.map((row, index) => `<li><a class="rank-row" href="${escapeHtml(skillLink(row.id))}"><span class="rank">${index + 1}</span>${img(row.authorHandle)}<span class="rank-info"><strong>${escapeHtml(row.name)}</strong><small>@${escapeHtml(row.authorHandle)}</small></span><span class="count" aria-label="${row.installs} reported installs">${compact(row.installs)}</span></a></li>`).join('')}</ol><p class="updated">Updated <time datetime="${date}">${date}</time></p>`;
  const collectionCards = topics.map(topic => {
    const authors = [...new Set((topic.featuredSkillIds ?? topic.skillIds ?? []).map(id => id.split('/')[0]))].slice(0, 3);
    return `<a class="collection" href="/collections/${encodeURIComponent(topic.id)}/"><div class="collection-top"><div class="avatar-stack">${authors.map(img).join('')}</div><h3>${escapeHtml(topic.title)}</h3></div><p>${escapeHtml(topic.subtitle || topic.description || '')}</p></a>`;
  }).join('\n');
  const suggestions = [];
  const seen = new Set();
  for (const topic of topics) {
    for (const id of topic.featuredSkillIds ?? topic.skillIds ?? []) {
      if (seen.has(id) || suggestions.length >= 16) continue;
      seen.add(id);
      const [repo, skill] = id.split(':');
      const name = (skill || repo).split('/').at(-1);
      suggestions.push(`<a class="skill-pill" href="${escapeHtml(skillLink(id))}">${img(repo.split('/')[0])}<span>${escapeHtml(name)}</span><span class="handle">@${escapeHtml(repo.split('/')[0])}</span></a>`);
    }
  }
  const tracks = [suggestions.slice(0, 8), suggestions.slice(8)].map(links => `<div class="suggestion-track"><div class="suggestion-set">${links.join('')}</div><div class="suggestion-set" aria-hidden="true" inert>${links.join('')}</div></div>`).join('\n');
  return {rankings, collections: collectionCards, suggestions: tracks};
}

export function replaceHomeContent(html, sections) {
  for (const [name, content] of Object.entries(sections)) {
    const start = `<!-- home:${name}:start -->`;
    const end = `<!-- home:${name}:end -->`;
    const from = html.indexOf(start);
    const to = html.indexOf(end);
    if (from < 0 || to <= from || html.indexOf(start, from + 1) !== -1 || html.indexOf(end, to + 1) !== -1) {
      throw new Error(`Invalid home preview markers: ${name}`);
    }
    html = html.slice(0, from + start.length) + '\n' + content + '\n        ' + html.slice(to);
  }
  return html;
}

export async function refreshHomePreview({siteDir}) {
  const dataDir = path.join(siteDir, 'data', 'v2');
  const manifest = JSON.parse(await readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
  const asset = manifest.leaderboardViewData?.path;
  if (!asset || path.basename(asset) !== asset || !/^leaderboard-view-data-[a-f0-9]+\.json$/.test(asset)) {
    throw new Error('Invalid leaderboard view asset in manifest');
  }
  const collections = await loadHomepageCollections(siteDir);
  const data = JSON.parse(await readFile(path.join(dataDir, asset), 'utf8'));
  const file = path.join(siteDir, 'home', 'index.html');
  const html = await readFile(file, 'utf8');
  await writeFile(file, replaceHomeContent(html, renderHomeContent(collections, data)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await refreshHomePreview({siteDir: path.resolve(process.argv[2] || 'site')});
  console.log('Refreshed /home/ with 6 collections and up to 10 ranked skills.');
}
