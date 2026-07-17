import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSkillEquivalenceShadow,
  loadSkillEquivalenceOverrides,
  type SkillEquivalenceArtifact,
  type SkillEquivalenceOverrides,
  type SkillEquivalenceReviewReport,
  type SkillEquivalenceSkill,
} from "../scraper/new-crawl/skill-equivalence.js";

type Asset = {
  path: string;
  sha256: string;
  bytes: number;
};

type Manifest = Record<string, unknown> & {
  skillEquivalence?: Asset;
};

export type SkillEquivalencePublishMode = "noop" | "publish" | "remove";

export type SkillEquivalenceTrack = {
  name: string;
  dir: string;
};

export type PublishSkillEquivalenceOptions = {
  mode: SkillEquivalencePublishMode;
  tracks: SkillEquivalenceTrack[];
  skills?: SkillEquivalenceSkill[];
  overrides?: SkillEquivalenceOverrides;
  generatedAt?: string;
};

export type PublishSkillEquivalenceResult = {
  mode: SkillEquivalencePublishMode;
  changed: boolean;
  artifact?: SkillEquivalenceArtifact;
  review?: SkillEquivalenceReviewReport;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");
const skillsPath = join(indexRoot, "skills.json");
const overridesPath = join(indexRoot, "seeds", "skill-equivalence-overrides.json");
const dataRoot = resolve(process.env.OMGSKILLS_DATA_ROOT ?? join(repoRoot, "site", "data"));
const dataTracks: SkillEquivalenceTrack[] = [
  { name: "crawl4", dir: join(dataRoot, "crawl4") },
  { name: "v2", dir: join(dataRoot, "v2") },
];

function fail(message: string): never {
  throw new Error(`publish-skill-equivalence: ${message}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function skillEquivalencePublishMode(
  env: NodeJS.ProcessEnv = process.env,
): SkillEquivalencePublishMode {
  const value = env.SKILL_EQUIVALENCE_PUBLISH?.trim().toLowerCase();
  if (!value) return "noop";
  if (value === "1") return "publish";
  if (value === "0" || value === "remove") return "remove";
  fail(`invalid SKILL_EQUIVALENCE_PUBLISH value "${value}"; expected 1, 0, remove, or unset`);
}

function manifestPath(dataDir: string): string {
  return join(dataDir, "manifest.json");
}

function readManifest(dataDir: string): Manifest {
  const path = manifestPath(dataDir);
  if (!existsSync(path)) fail(`missing manifest: ${path}`);
  return readJson<Manifest>(path);
}

function artifactContent(
  artifact: SkillEquivalenceArtifact,
): Omit<SkillEquivalenceArtifact, "generatedAt"> {
  return {
    version: artifact.version,
    groups: artifact.groups,
  };
}

function sameArtifactContent(
  left: SkillEquivalenceArtifact,
  right: SkillEquivalenceArtifact,
): boolean {
  return JSON.stringify(artifactContent(left)) === JSON.stringify(artifactContent(right));
}

function loadExistingArtifact(track: SkillEquivalenceTrack): SkillEquivalenceArtifact | null {
  const manifest = readManifest(track.dir);
  if (!manifest.skillEquivalence) return null;
  const path = join(track.dir, manifest.skillEquivalence.path);
  if (!existsSync(path)) {
    fail(`${track.name} manifest references missing skill equivalence asset: ${manifest.skillEquivalence.path}`);
  }
  return readJson<SkillEquivalenceArtifact>(path);
}

function chooseGeneratedAt(
  proposed: SkillEquivalenceArtifact,
  existing: SkillEquivalenceArtifact[],
): string {
  return existing
    .filter((artifact) => sameArtifactContent(artifact, proposed))
    .map((artifact) => artifact.generatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? proposed.generatedAt;
}

export function writeSkillEquivalenceAsset(
  dataDir: string,
  artifact: SkillEquivalenceArtifact,
): Asset {
  mkdirSync(dataDir, { recursive: true });
  const data = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const hash = sha256(data);
  const filename = `skill-equivalence-${hash.slice(0, 12)}.json`;
  const path = join(dataDir, filename);
  if (!existsSync(path)) writeFileSync(path, data);
  return { path: filename, sha256: hash, bytes: data.length };
}

export function patchSkillEquivalenceManifest(
  dataDir: string,
  asset: Asset | null,
): boolean {
  const path = manifestPath(dataDir);
  const manifest = readManifest(dataDir);
  if (asset) {
    if (JSON.stringify(manifest.skillEquivalence) === JSON.stringify(asset)) return false;
    manifest.skillEquivalence = asset;
  } else {
    if (manifest.skillEquivalence === undefined) return false;
    delete manifest.skillEquivalence;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

export function pruneSupersededSkillEquivalenceAssets(
  dataDir: string,
  keepPaths: string[],
): void {
  const keep = new Set(keepPaths.filter(Boolean));
  for (const file of readdirSync(dataDir)) {
    if (
      !file.startsWith("skill-equivalence-") ||
      !file.endsWith(".json") ||
      keep.has(file)
    ) {
      continue;
    }
    rmSync(join(dataDir, file), { force: true });
  }
}

export function previousSkillEquivalenceAssetPath(
  dataDir: string,
  currentPath: string,
): string | undefined {
  return readdirSync(dataDir)
    .filter((file) =>
      file.startsWith("skill-equivalence-") &&
      file.endsWith(".json") &&
      file !== currentPath
    )
    .map((file) => {
      try {
        return {
          file,
          generatedAt: readJson<SkillEquivalenceArtifact>(join(dataDir, file)).generatedAt ?? "",
        };
      } catch {
        return { file, generatedAt: "" };
      }
    })
    .sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt) || right.file.localeCompare(left.file)
    )[0]?.file;
}

export function publishSkillEquivalence(
  options: PublishSkillEquivalenceOptions,
): PublishSkillEquivalenceResult {
  if (options.mode === "noop") {
    return { mode: "noop", changed: false };
  }

  if (options.mode === "remove") {
    for (const track of options.tracks) readManifest(track.dir);
    let changed = false;
    for (const track of options.tracks) {
      changed = patchSkillEquivalenceManifest(track.dir, null) || changed;
    }
    return { mode: "remove", changed };
  }

  if (!options.skills || !options.overrides || !options.generatedAt) {
    fail("publish mode requires skills, overrides, and generatedAt");
  }

  const existingArtifacts = options.tracks
    .map(loadExistingArtifact)
    .filter((artifact): artifact is SkillEquivalenceArtifact => Boolean(artifact));
  const built = buildSkillEquivalenceShadow(
    options.skills,
    options.generatedAt,
    options.overrides,
  );
  const artifact: SkillEquivalenceArtifact = {
    ...built.artifact,
    generatedAt: chooseGeneratedAt(built.artifact, existingArtifacts),
  };
  let changed = false;

  for (const track of options.tracks) {
    const priorPath = readManifest(track.dir).skillEquivalence?.path ?? "";
    const written = writeSkillEquivalenceAsset(track.dir, artifact);
    changed = patchSkillEquivalenceManifest(track.dir, written) || changed;
    const previousPath = priorPath && priorPath !== written.path && existsSync(join(track.dir, priorPath))
      ? priorPath
      : previousSkillEquivalenceAssetPath(track.dir, written.path);
    pruneSupersededSkillEquivalenceAssets(track.dir, [written.path, previousPath ?? ""]);
  }

  return {
    mode: "publish",
    changed,
    artifact,
    review: built.review,
  };
}

function main(): void {
  const mode = skillEquivalencePublishMode();
  if (mode === "noop") {
    console.log("skill equivalence publication unchanged (flag unset)");
    return;
  }

  if (mode === "remove") {
    const result = publishSkillEquivalence({ mode, tracks: dataTracks });
    console.log(
      `${result.changed ? "removed" : "left absent"} skillEquivalence manifest entries; asset files retained`,
    );
    return;
  }

  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);
  if (!existsSync(overridesPath)) fail(`missing ${overridesPath}`);

  // shadow-crawl-health runs this after promote:cutover and both data publishers.
  // The policy must read the suppression-filtered skills.json being published.
  const result = publishSkillEquivalence({
    mode,
    tracks: dataTracks,
    skills: readJson<SkillEquivalenceSkill[]>(skillsPath),
    overrides: loadSkillEquivalenceOverrides(overridesPath),
    generatedAt: new Date().toISOString(),
  });
  console.log(
    `${result.changed ? "published" : "reused"} ${result.artifact?.groups.length ?? 0} skill equivalence groups`,
  );
  if (result.review?.summary.pendingReviewCount || result.review?.summary.staleOverrideCount) {
    console.log(
      `review status: ${result.review.summary.pendingReviewCount} pending, ${result.review.summary.staleOverrideCount} stale overrides`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
