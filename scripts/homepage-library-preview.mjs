#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const homepageLibraryProfiles = [
  { handle: "anthropics", title: "Anthropic" },
  { handle: "openai", title: "OpenAI" },
  { handle: "shadcn", title: "shadcn" },
  { handle: "github", title: "GitHub" },
  { handle: "mattpocock", title: "Matt Pocock" },
  { handle: "google-gemini", title: "Google Gemini" },
  { handle: "simonw", title: "Simon Willison" },
  { handle: "microsoft", title: "Microsoft" },
  { handle: "addyosmani", title: "Addy Osmani" },
  { handle: "stripe", title: "Stripe" },
  { handle: "steipete", title: "Peter Steinberger" },
  { handle: "huggingface", title: "Hugging Face" },
  { handle: "antfu", title: "Anthony Fu" },
  { handle: "supabase", title: "Supabase" },
  { handle: "obra", title: "Jesse Vincent (obra)" },
  { handle: "vercel-labs", title: "Vercel Labs" },
  { handle: "kepano", title: "Steph Ango (kepano)" },
  { handle: "garrytan", title: "Garry Tan" },
];

export const homepageLibraryPaths = homepageLibraryProfiles.map(
  ({ handle }) => `/library/${handle}/`,
);

export const homepageLibraryStartMarker = "<!-- homepage-library-preview:start -->";
export const homepageLibraryEndMarker = "<!-- homepage-library-preview:end -->";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function markerRange(html) {
  const start = html.indexOf(homepageLibraryStartMarker);
  const end = html.indexOf(homepageLibraryEndMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Homepage library preview markers are missing or out of order");
  }
  if (
    html.indexOf(homepageLibraryStartMarker, start + homepageLibraryStartMarker.length) >= 0 ||
    html.indexOf(homepageLibraryEndMarker, end + homepageLibraryEndMarker.length) >= 0
  ) {
    throw new Error("Homepage library preview markers must appear exactly once");
  }
  return { start, end };
}

export async function loadHomepageCollections(siteDir) {
  const dataDir = path.join(siteDir, "data", "v2");
  const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8"));
  const assetPath = manifest.collections?.path;
  if (!assetPath || path.basename(assetPath) !== assetPath) {
    throw new Error("The v2 manifest does not reference a valid collections asset");
  }
  const payload = JSON.parse(await readFile(path.join(dataDir, assetPath), "utf8"));
  if (!Array.isArray(payload.collections)) {
    throw new Error("The collections asset does not contain a collections array");
  }
  return payload.collections;
}

export function renderHomepageLibraryCards(collections) {
  const profilesByHandle = new Map();
  for (const collection of collections) {
    if (collection.type !== "author" || !collection.authorHandle) continue;
    const handle = String(collection.authorHandle).toLowerCase();
    if (profilesByHandle.has(handle)) {
      throw new Error(`Duplicate homepage profile data for ${handle}`);
    }
    profilesByHandle.set(handle, collection);
  }

  return homepageLibraryProfiles.map(({ handle, title }) => {
    const profile = profilesByHandle.get(handle);
    if (!profile) throw new Error(`Missing homepage profile data for ${handle}`);
    const imageUrl = profile.imageUrl || `https://github.com/${encodeURIComponent(handle)}.png?size=128`;
    const subtitle = profile.subtitle || `Skills by ${title}`;
    const description = profile.description && profile.description !== profile.subtitle
      ? `\n          <p class="library-profile-description">${escapeHtml(profile.description)}</p>`
      : "";
    return `        <a class="library-profile-card" href="/library/${encodeURIComponent(handle)}/">
          <div class="library-profile-heading">
            <span class="library-profile-image"><span aria-hidden="true">&#128064;</span><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)} profile image" loading="lazy" decoding="async" onerror="this.remove()"></span>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <p class="library-profile-subtitle">${escapeHtml(subtitle)}</p>${description}
        </a>`;
  }).join("\n");
}

export function injectHomepageLibraryPreview(html, cards) {
  const { start, end } = markerRange(html);
  const contentStart = start + homepageLibraryStartMarker.length;
  return `${html.slice(0, contentStart)}\n${cards}\n        ${html.slice(end)}`;
}

export function verifyHomepageLibraryPreview(html, label = "homepage") {
  const { start, end } = markerRange(html);
  const block = html.slice(start + homepageLibraryStartMarker.length, end);
  if (/<script\b/i.test(block)) {
    throw new Error(`${label} placed homepage profile links inside a script`);
  }
  const paths = [...block.matchAll(/<a\b[^>]*\bhref="(\/library\/[^"#?]+\/)"[^>]*>/gi)]
    .map((match) => match[1]);
  if (paths.length !== homepageLibraryPaths.length) {
    throw new Error(
      `${label} contained ${paths.length} static homepage profile links; expected ${homepageLibraryPaths.length}`,
    );
  }
  for (let index = 0; index < homepageLibraryPaths.length; index += 1) {
    if (paths[index] !== homepageLibraryPaths[index]) {
      throw new Error(
        `${label} homepage profile ${index + 1} was ${paths[index]}; expected ${homepageLibraryPaths[index]}`,
      );
    }
  }
  return paths;
}

export async function refreshHomepageLibraryPreview({ homepagePath, siteDir }) {
  const [html, collections] = await Promise.all([
    readFile(homepagePath, "utf8"),
    loadHomepageCollections(siteDir),
  ]);
  const nextHtml = injectHomepageLibraryPreview(html, renderHomepageLibraryCards(collections));
  verifyHomepageLibraryPreview(nextHtml, homepagePath);
  await writeFile(homepagePath, nextHtml);
  return homepageLibraryPaths;
}

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
  const homepagePath = path.join(siteDir, "index.html");
  if (process.argv.includes("--check")) {
    verifyHomepageLibraryPreview(await readFile(homepagePath, "utf8"), homepagePath);
    console.log(`Homepage library preview verified: ${homepageLibraryPaths.length} static links`);
    return;
  }
  await refreshHomepageLibraryPreview({ homepagePath, siteDir });
  console.log(`Homepage library preview updated: ${homepageLibraryPaths.length} static links`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
