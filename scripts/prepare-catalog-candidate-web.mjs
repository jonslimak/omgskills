#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const candidateOrigin = "https://omgskills-setup-test-f3b.netlify.app";
const productionOrigin = "https://omgskills.com";

export function hostingFiles() {
  // Explicit public reads only. No portal/account route or public app/download fallback.
  const reads = ["/mcp", "/mcp/health", "/catalog-skill-urls.json"];
  const redirects = ["/ /app/ 302", ...reads.map(route => `${route} ${productionOrigin}${route} 200`),
    `/data/crawl4/* ${productionOrigin}/data/crawl4/:splat 200`,
    `/data/v2/* ${productionOrigin}/data/v2/:splat 200`];
  return {
    "_redirects": redirects.join("\n") + "\n",
    "_headers": "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'\n",
    "robots.txt": "User-agent: *\nDisallow: /\n",
    "404.html": "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Not available</title><h1>This route is not available in the candidate test.</h1></html>\n",
  };
}

export function candidateBuildOptions(output) {
  return {
    root: path.join(root, "portal"), configFile: false, envFile: false, base: "/app/",
    plugins: [react(), tailwindcss(), {
      name: "catalog-candidate-entry-only",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          assert.equal(html.split("/src/bootstrap.ts").length, 2, "Expected the unchanged normal entry marker");
          return html.replace("/src/bootstrap.ts", "/src/candidate/main.tsx").replace("<title>omgskills</title>", "<title>OMGSkills Candidate</title>");
        },
      },
    }],
    resolve: { alias: { "@": path.join(root, "portal/src") } },
    build: { outDir: path.join(output, "app"), emptyOutDir: false, minify: false },
  };
}

async function hashes(directory, prefix = "") {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name, absolute = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), "Candidate output must not contain symlinks");
    if (entry.isDirectory()) Object.assign(result, await hashes(absolute, relative + "/"));
    else result[relative] = createHash("sha256").update(await readFile(absolute)).digest("hex");
  }
  return result;
}

export async function prepareCandidateWeb() {
  const parent = path.join(root, "menubar/.build/catalog-candidate-web");
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, "candidate-"));
  const site = path.join(output, "site");
  await mkdir(site);
  await build(candidateBuildOptions(site));
  for (const [name, body] of Object.entries(hostingFiles())) await writeFile(path.join(site, name), body, { flag: "wx" });
  const receipt = {
    stage: "candidate-web-prepared-not-hosted", site, origin: candidateOrigin,
    deployable: false,
    hostingPrerequisite: "Merge with and verify retained dedicated-site setup pages, downloads, update feeds and the local read-only record function before deployment. This web overlay is not a standalone deploy artifact.",
    appIdentity: "com.jonslimak.omgskills", scheme: "omgskills", targets: ["claude", "codex"],
    recordEndpoint: candidateOrigin + "/api/catalog/install-record",
    download: null, updateFeed: null,
    boundary: "Separate public-install candidate entry. No sign-in, signing, hosting, app registration or installation. VM only.",
    files: await hashes(site),
  };
  await writeFile(path.join(output, "preparation.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareCandidateWeb().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
