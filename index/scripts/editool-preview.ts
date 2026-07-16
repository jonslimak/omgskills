import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

type ManifestAsset = {
  path: string;
};

type CollectionsManifest = {
  collections?: ManifestAsset;
};

type PublishedCollection = {
  id: string;
  type: "author" | "topic";
  authorHandle?: string;
};

type CollectionsAsset = {
  collections: PublishedCollection[];
};

export type EditoolPreviewResult = {
  builtAt: string;
  indexPath: string;
  profilePaths: string[];
  collectionPaths: string[];
};

type PreviewBuildOptions = {
  repoRoot: string;
  indexRoot: string;
  sourceSiteDir: string;
  previewDir: string;
  productionOrigin?: string;
};

const staticRootFiles = ["index.html", "robots.txt", "llms.txt", "favicon.svg"];
const dataTracks = ["", "v2", "crawl4"];
const require = createRequire(import.meta.url);

export function defaultEditoolPreviewDir(): string {
  return join(tmpdir(), "omgskills-editool-preview");
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

export function collectManifestAssetPaths(value: unknown): string[] {
  const paths = new Set<string>();

  function visit(item: unknown): void {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!item || typeof item !== "object") return;

    const record = item as Record<string, unknown>;
    if (typeof record.path === "string") paths.add(record.path);
    for (const child of Object.values(record)) visit(child);
  }

  visit(value);
  return [...paths];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyStaticRootFiles(sourceSiteDir: string, previewDir: string): Promise<void> {
  for (const filename of staticRootFiles) {
    const source = join(sourceSiteDir, filename);
    if (!(await exists(source))) continue;
    await copyFile(source, join(previewDir, filename));
  }
}

async function linkManifestAssets(sourceDataDir: string, previewDataDir: string): Promise<void> {
  const sourceManifestPath = join(sourceDataDir, "manifest.json");
  if (!(await exists(sourceManifestPath))) return;

  await mkdir(previewDataDir, { recursive: true });
  const manifest = JSON.parse(await readFile(sourceManifestPath, "utf8")) as unknown;
  await copyFile(sourceManifestPath, join(previewDataDir, "manifest.json"));

  for (const assetPath of collectManifestAssetPaths(manifest)) {
    if (!assetPath || assetPath.startsWith("/") || assetPath.includes("\0")) {
      throw new Error(`Unsafe manifest asset path: ${assetPath}`);
    }

    const sourceAsset = resolve(sourceDataDir, assetPath);
    const previewAsset = resolve(previewDataDir, assetPath);
    if (!isWithin(sourceDataDir, sourceAsset) || !isWithin(previewDataDir, previewAsset)) {
      throw new Error(`Manifest asset escapes its data directory: ${assetPath}`);
    }
    if (!(await exists(sourceAsset))) continue;

    await mkdir(dirname(previewAsset), { recursive: true });
    await symlink(sourceAsset, previewAsset);
  }
}

export async function prepareEditoolPreviewWorkspace(
  sourceSiteDir: string,
  previewDir: string,
): Promise<void> {
  await rm(previewDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });
  await copyStaticRootFiles(sourceSiteDir, previewDir);

  for (const track of dataTracks) {
    await linkManifestAssets(
      join(sourceSiteDir, "data", track),
      join(previewDir, "data", track),
    );
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${output.trim()}`));
    });
  });
}

function slugSegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

async function previewRoutes(previewDir: string): Promise<Pick<EditoolPreviewResult, "profilePaths" | "collectionPaths">> {
  const manifestPath = join(previewDir, "data", "crawl4", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CollectionsManifest;
  if (!manifest.collections?.path) throw new Error("Preview manifest has no collections asset");

  const collectionsPath = join(dirname(manifestPath), manifest.collections.path);
  const asset = JSON.parse(await readFile(collectionsPath, "utf8")) as CollectionsAsset;
  const profilePaths: string[] = [];
  const collectionPaths: string[] = [];

  for (const collection of asset.collections) {
    if (collection.type === "author" && collection.authorHandle) {
      profilePaths.push(`/library/${slugSegment(collection.authorHandle)}/`);
    } else if (collection.type === "topic") {
      collectionPaths.push(`/collections/${slugSegment(collection.id)}/`);
    }
  }

  return { profilePaths, collectionPaths };
}

export async function buildEditoolPreview(options: PreviewBuildOptions): Promise<EditoolPreviewResult> {
  const productionOrigin = options.productionOrigin ?? "https://omgskills.com";
  const env = {
    ...process.env,
    SITE_DIR: options.previewDir,
    PRODUCTION_ORIGIN: productionOrigin,
  };
  const tsxCli = require.resolve("tsx/cli");

  await prepareEditoolPreviewWorkspace(options.sourceSiteDir, options.previewDir);
  await runCommand(process.execPath, [tsxCli, join(options.indexRoot, "scripts", "publish-collections.ts")], {
    cwd: options.indexRoot,
    env,
  });
  await runCommand(process.execPath, [join(options.repoRoot, "scripts", "build-web-library.mjs")], {
    cwd: options.repoRoot,
    env,
  });
  await runCommand(process.execPath, [join(options.repoRoot, "scripts", "verify-web-library-pages.mjs")], {
    cwd: options.repoRoot,
    env,
  });

  return {
    builtAt: new Date().toISOString(),
    indexPath: "/skills/",
    ...(await previewRoutes(options.previewDir)),
  };
}

export function resolvePreviewFilePath(rootDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const requested = resolve(rootDir, decoded.replace(/^\/+/, ""));
  if (!isWithin(rootDir, requested)) return null;
  return decoded.endsWith("/") ? join(requested, "index.html") : requested;
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".xml": return "application/xml; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

export function createEditoolPreviewServer(rootDir: string): Server {
  return createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let filePath = resolvePreviewFilePath(rootDir, url.pathname);
    if (!filePath) {
      res.writeHead(400);
      res.end("Invalid preview path");
      return;
    }

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, "index.html");
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) throw new Error("not a file");

      res.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": fileInfo.size,
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end("Preview not built. Use Build local preview in Editool.");
    }
  });
}
