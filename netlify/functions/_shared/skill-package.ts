import { createHash } from "node:crypto";

export type SkillPackageCoordinates = {
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
};

export type SkillPackageEntry = {
  path: string;
  mode: string;
  data: Buffer;
  blobSha: string;
};

export type SkillPackage = {
  coordinates: SkillPackageCoordinates;
  entries: SkillPackageEntry[];
};

export type SkillPackageValidationLimits = {
  maximumFileCount: number;
  maximumTotalBytes: number;
  maximumFileBytes: number;
  maximumSkillMdBytes: number;
};

export const STANDARD_SKILL_PACKAGE_LIMITS: SkillPackageValidationLimits = {
  maximumFileCount: 512,
  maximumTotalBytes: 50 * 1024 * 1024,
  maximumFileBytes: 10 * 1024 * 1024,
  maximumSkillMdBytes: 2 * 1024 * 1024
};

// Netlify streamed responses are capped at 20 MB. Base64 adds roughly one third.
export const BROKER_SKILL_PACKAGE_LIMITS: SkillPackageValidationLimits = {
  ...STANDARD_SKILL_PACKAGE_LIMITS,
  maximumTotalBytes: 12 * 1024 * 1024
};

const MAX_STREAM_BYTES = 19_000_000;
const regularFileMode = "100644";
const executableFileMode = "100755";

export type SkillPackageValidationCode =
  | "invalid_sha"
  | "commit_sha_mismatch"
  | "tree_sha_mismatch"
  | "skill_md_sha_mismatch"
  | "blob_sha_mismatch"
  | "invalid_path"
  | "duplicate_path"
  | "path_conflict"
  | "case_collision"
  | "symbolic_link"
  | "submodule"
  | "unsupported_entry_type"
  | "too_many_files"
  | "file_too_large"
  | "skill_md_too_large"
  | "package_too_large"
  | "missing_skill_md"
  | "stream_too_large";

export class SkillPackageValidationError extends Error {
  constructor(readonly code: SkillPackageValidationCode, readonly path?: string) {
    super(path ? `${code}: ${path}` : code);
    this.name = "SkillPackageValidationError";
  }
}

export type ValidatedSkillPackage = {
  coordinates: SkillPackageCoordinates;
  fileCount: number;
  totalBytes: number;
};

type TreeFile = { mode: string; sha: string };

class TreeDirectory {
  readonly files = new Map<string, TreeFile>();
  readonly directories = new Map<string, TreeDirectory>();

  insert(components: string[], file: TreeFile, fullPath: string): void {
    const [name, ...remaining] = components;
    if (!name) throw failure("invalid_path", fullPath);
    if (remaining.length === 0) {
      if (this.files.has(name)) throw failure("duplicate_path", fullPath);
      if (this.directories.has(name)) throw failure("path_conflict", fullPath);
      this.files.set(name, file);
      return;
    }
    if (this.files.has(name)) throw failure("path_conflict", fullPath);
    const child = this.directories.get(name) ?? new TreeDirectory();
    this.directories.set(name, child);
    child.insert(remaining, file, fullPath);
  }

  sha(): string {
    const objects: Array<{ name: string; mode: string; sha: string; directory: boolean }> = [];
    for (const [name, file] of this.files) {
      objects.push({ name, mode: file.mode, sha: file.sha, directory: false });
    }
    for (const [name, directory] of this.directories) {
      objects.push({ name, mode: "40000", sha: directory.sha(), directory: true });
    }
    objects.sort((left, right) => Buffer.compare(
      Buffer.from(`${left.name}${left.directory ? "/" : ""}`),
      Buffer.from(`${right.name}${right.directory ? "/" : ""}`)
    ));
    const content = Buffer.concat(objects.flatMap((object) => [
      Buffer.from(`${object.mode} ${object.name}\0`),
      Buffer.from(object.sha, "hex")
    ]));
    return gitObjectSha("tree", content);
  }
}

function failure(code: SkillPackageValidationCode, path?: string): SkillPackageValidationError {
  return new SkillPackageValidationError(code, path);
}

function normalizedSha(value: string, field: string): string {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw failure("invalid_sha", field);
  return value.toLowerCase();
}

function normalizedCoordinates(coordinates: SkillPackageCoordinates): SkillPackageCoordinates {
  return {
    commitSha: normalizedSha(coordinates.commitSha, "commitSha"),
    treeSha: normalizedSha(coordinates.treeSha, "treeSha"),
    skillMdSha: normalizedSha(coordinates.skillMdSha, "skillMdSha")
  };
}

function validatedPathComponents(path: string): string[] {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    throw failure("invalid_path", path);
  }
  const components = path.split("/");
  if (components.some((component) => !component || component === "." || component === ".." || component.toLowerCase() === ".git")) {
    throw failure("invalid_path", path);
  }
  return components;
}

function validateMode(mode: string, path: string): void {
  if (mode === regularFileMode || mode === executableFileMode) return;
  if (mode === "120000") throw failure("symbolic_link", path);
  if (mode === "160000") throw failure("submodule", path);
  throw failure("unsupported_entry_type", path);
}

export function gitObjectSha(type: "blob" | "tree", data: Uint8Array): string {
  return createHash("sha1")
    .update(Buffer.from(`${type} ${data.byteLength}\0`))
    .update(data)
    .digest("hex");
}

export function validateSkillPackage(
  skillPackage: SkillPackage,
  expected: SkillPackageCoordinates,
  limits: SkillPackageValidationLimits = STANDARD_SKILL_PACKAGE_LIMITS
): ValidatedSkillPackage {
  const expectedCoordinates = normalizedCoordinates(expected);
  const packageCoordinates = normalizedCoordinates(skillPackage.coordinates);
  if (packageCoordinates.commitSha !== expectedCoordinates.commitSha) throw failure("commit_sha_mismatch");
  if (packageCoordinates.treeSha !== expectedCoordinates.treeSha) throw failure("tree_sha_mismatch");
  if (packageCoordinates.skillMdSha !== expectedCoordinates.skillMdSha) throw failure("skill_md_sha_mismatch");
  if (skillPackage.entries.length > limits.maximumFileCount) throw failure("too_many_files");

  const exactPaths = new Set<string>();
  const portableOwners = new Map<string, string>();
  const tree = new TreeDirectory();
  let totalBytes = 0;
  let actualSkillMdSha: string | undefined;

  for (const entry of skillPackage.entries) {
    const components = validatedPathComponents(entry.path);
    if (exactPaths.has(entry.path)) throw failure("duplicate_path", entry.path);
    exactPaths.add(entry.path);

    for (let index = 0; index < components.length; index += 1) {
      const prefix = components.slice(0, index + 1).join("/");
      const portable = components.slice(0, index + 1)
        .map((component) => component.normalize("NFC").toLocaleLowerCase("en-US"))
        .join("/");
      const owner = portableOwners.get(portable);
      if (owner !== undefined && owner !== prefix) throw failure("case_collision", entry.path);
      portableOwners.set(portable, prefix);
    }

    validateMode(entry.mode, entry.path);
    if (entry.data.byteLength > limits.maximumFileBytes) throw failure("file_too_large", entry.path);
    if (entry.path === "SKILL.md" && entry.data.byteLength > limits.maximumSkillMdBytes) {
      throw failure("skill_md_too_large", entry.path);
    }
    totalBytes += entry.data.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maximumTotalBytes) {
      throw failure("package_too_large");
    }

    const declaredBlobSha = normalizedSha(entry.blobSha, entry.path);
    const actualBlobSha = gitObjectSha("blob", entry.data);
    if (declaredBlobSha !== actualBlobSha) throw failure("blob_sha_mismatch", entry.path);
    if (entry.path === "SKILL.md") actualSkillMdSha = actualBlobSha;
    tree.insert(components, { mode: entry.mode, sha: actualBlobSha }, entry.path);
  }

  if (!actualSkillMdSha) throw failure("missing_skill_md");
  if (actualSkillMdSha !== expectedCoordinates.skillMdSha) throw failure("skill_md_sha_mismatch", "SKILL.md");
  if (tree.sha() !== expectedCoordinates.treeSha) throw failure("tree_sha_mismatch");

  return {
    coordinates: expectedCoordinates,
    fileCount: skillPackage.entries.length,
    totalBytes
  };
}

export function skillPackageNdjson(
  input: { sourceId: string; releaseId: string; package: SkillPackage }
): { body: ReadableStream<Uint8Array>; contentLength: number } {
  validateSkillPackage(input.package, input.package.coordinates, BROKER_SKILL_PACKAGE_LIMITS);
  const lines = [
    JSON.stringify({
      type: "omgskills.skill_package",
      version: 1,
      sourceId: input.sourceId,
      releaseId: input.releaseId,
      coordinates: input.package.coordinates,
      fileCount: input.package.entries.length
    }),
    ...input.package.entries.map((entry) => JSON.stringify({
      type: "file",
      path: entry.path,
      mode: entry.mode,
      blobSha: entry.blobSha,
      data: entry.data.toString("base64")
    })),
    JSON.stringify({ type: "end" })
  ].map((line) => Buffer.from(`${line}\n`));
  const contentLength = lines.reduce((total, line) => total + line.byteLength, 0);
  if (contentLength > MAX_STREAM_BYTES) throw failure("stream_too_large");
  return {
    contentLength,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(line);
        controller.close();
      }
    })
  };
}
