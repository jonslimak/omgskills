import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RepoMeta } from "../enrich.js";

export type RefreshReplayKind = "repo-meta" | "tree" | "raw-file";
export type RefreshReplayMode = "off" | "record" | "replay";

type ReplayOk<T> = {
  key: string;
  kind: "ok";
  value: T;
};

type ReplayNull = {
  key: string;
  kind: "null";
};

type ReplayError = {
  key: string;
  kind: "error";
  message: string;
  status?: number;
};

type RefreshReplayEntry<T> = ReplayOk<T> | ReplayNull | ReplayError;

type RawFileResult = {
  content: string;
  sha: string;
};

const MODE_ENV = "OMGSKILLS_REFRESH_REPLAY_MODE";
const ROOT_ENV = "OMGSKILLS_REFRESH_REPLAY_ROOT";

export class RefreshReplayError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function hashKey(key: string): string {
  return createHash("sha1").update(key).digest("hex");
}

function kindDirName(kind: RefreshReplayKind): string {
  if (kind === "repo-meta") return "repo-meta";
  if (kind === "tree") return "tree";
  return "raw-file";
}

export function buildRefreshReplayPath(root: string, kind: RefreshReplayKind, key: string): string {
  return join(root, kindDirName(kind), `${hashKey(key)}.json`);
}

function readEntry<T>(path: string): RefreshReplayEntry<T> {
  return JSON.parse(readFileSync(path, "utf8")) as RefreshReplayEntry<T>;
}

function writeEntry<T>(path: string, entry: RefreshReplayEntry<T>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
}

export class RefreshReplayStore {
  constructor(
    readonly mode: RefreshReplayMode,
    readonly root: string | null,
  ) {}

  private requireRoot(): string {
    if (!this.root) throw new Error("refresh replay root is not configured");
    return this.root;
  }

  private replayEntry<T>(kind: RefreshReplayKind, key: string): RefreshReplayEntry<T> {
    const path = buildRefreshReplayPath(this.requireRoot(), kind, key);
    if (!existsSync(path)) {
      throw new Error(`missing refresh replay entry for ${kind}:${key}`);
    }
    const entry = readEntry<T>(path);
    if (entry.key !== key) {
      throw new Error(`refresh replay key mismatch for ${kind}:${key}`);
    }
    return entry;
  }

  private recordEntry<T>(kind: RefreshReplayKind, key: string, entry: RefreshReplayEntry<T>) {
    writeEntry(buildRefreshReplayPath(this.requireRoot(), kind, key), entry);
  }

  async repoMeta(
    key: string,
    load: () => Promise<RepoMeta>,
  ): Promise<RepoMeta> {
    if (this.mode === "replay") {
      const entry = this.replayEntry<RepoMeta>( "repo-meta", key);
      if (entry.kind === "ok") return entry.value;
      if (entry.kind === "error") throw new RefreshReplayError(entry.message, entry.status);
      throw new Error(`invalid null repo-meta replay entry for ${key}`);
    }

    try {
      const value = await load();
      if (this.mode === "record") this.recordEntry("repo-meta", key, { key, kind: "ok", value });
      return value;
    } catch (error) {
      if (this.mode === "record") {
        const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
        const message = error instanceof Error ? error.message : String(error);
        this.recordEntry("repo-meta", key, { key, kind: "error", message, status });
      }
      throw error;
    }
  }

  async tree(
    key: string,
    load: () => Promise<string[]>,
  ): Promise<string[]> {
    if (this.mode === "replay") {
      const entry = this.replayEntry<string[]>("tree", key);
      if (entry.kind === "ok") return entry.value;
      if (entry.kind === "error") throw new RefreshReplayError(entry.message, entry.status);
      throw new Error(`invalid null tree replay entry for ${key}`);
    }

    try {
      const value = await load();
      if (this.mode === "record") this.recordEntry("tree", key, { key, kind: "ok", value });
      return value;
    } catch (error) {
      if (this.mode === "record") {
        const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
        const message = error instanceof Error ? error.message : String(error);
        this.recordEntry("tree", key, { key, kind: "error", message, status });
      }
      throw error;
    }
  }

  async rawFile(
    key: string,
    load: () => Promise<RawFileResult | null>,
  ): Promise<RawFileResult | null> {
    if (this.mode === "replay") {
      const entry = this.replayEntry<RawFileResult>("raw-file", key);
      if (entry.kind === "ok") return entry.value;
      if (entry.kind === "null") return null;
      throw new RefreshReplayError(entry.message, entry.status);
    }

    try {
      const value = await load();
      if (this.mode === "record") {
        this.recordEntry("raw-file", key, value ? { key, kind: "ok", value } : { key, kind: "null" });
      }
      return value;
    } catch (error) {
      if (this.mode === "record") {
        const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
        const message = error instanceof Error ? error.message : String(error);
        this.recordEntry("raw-file", key, { key, kind: "error", message, status });
      }
      throw error;
    }
  }
}

export function createRefreshReplayStoreFromEnv(env = process.env): RefreshReplayStore {
  const modeValue = env[MODE_ENV];
  const root = env[ROOT_ENV] ?? null;
  if (modeValue !== "record" && modeValue !== "replay") {
    return new RefreshReplayStore("off", null);
  }
  if (!root) {
    throw new Error(`${ROOT_ENV} is required when ${MODE_ENV}=${modeValue}`);
  }
  return new RefreshReplayStore(modeValue, root);
}

export function refreshReplayEnv(mode: Exclude<RefreshReplayMode, "off">, root: string): Record<string, string> {
  return {
    [MODE_ENV]: mode,
    [ROOT_ENV]: root,
  };
}
