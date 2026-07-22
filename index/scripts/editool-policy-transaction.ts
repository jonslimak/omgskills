import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type EditoolFileMutation = {
  path: string;
  content: string;
  expectedRevision: string;
};

export type EditoolFileGuard = {
  path: string;
  expectedRevision: string;
};

type TransactionRecord = {
  targetPath: string;
  backupPath: string;
  stagedPath: string;
  originalExists: boolean;
  originalMode: number | null;
};

type TransactionJournal = {
  version: 1;
  id: string;
  state: "prepared" | "committed";
  records: TransactionRecord[];
};

export class EditoolStaleRevisionError extends Error {}
export class EditoolSaveBusyError extends Error {}

const ACTIVE_DIR = "active";
const JOURNAL_FILE = "journal.json";
const LOCK_FILE = "save.lock";

export function editoolFileRevision(path: string): string {
  if (!existsSync(path)) return "missing";
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function readJournal(activeDir: string): TransactionJournal | null {
  const path = join(activeDir, JOURNAL_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TransactionJournal;
}

function restoreJournal(journal: TransactionJournal): void {
  for (const record of journal.records) {
    if (!record.originalExists) {
      if (existsSync(record.targetPath)) unlinkSync(record.targetPath);
      continue;
    }
    const temporary = `${record.targetPath}.editool-restore`;
    copyFileSync(record.backupPath, temporary);
    if (record.originalMode !== null) chmodSync(temporary, record.originalMode);
    renameSync(temporary, record.targetPath);
  }
}

function recoverActiveTransaction(stateDir: string): "none" | "rolled-back" | "cleaned" {
  const activeDir = join(stateDir, ACTIVE_DIR);
  if (!existsSync(activeDir)) return "none";
  const journal = readJournal(activeDir);
  if (!journal) {
    rmSync(activeDir, { recursive: true, force: true });
    return "cleaned";
  }
  if (journal.state === "committed") {
    rmSync(activeDir, { recursive: true, force: true });
    return "cleaned";
  }
  restoreJournal(journal);
  rmSync(activeDir, { recursive: true, force: true });
  return "rolled-back";
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(stateDir: string): { fd: number; path: string } {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, LOCK_FILE);
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: number };
      if (value.pid && processIsAlive(value.pid)) {
        throw new EditoolSaveBusyError(`another Editool process owns ${path}`);
      }
    } catch (error) {
      if (error instanceof EditoolSaveBusyError) throw error;
    }
    unlinkSync(path);
  }
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return { fd, path };
  } catch (error) {
    throw new EditoolSaveBusyError(`Editool policy save is already running: ${String(error)}`);
  }
}

function releaseLock(lock: { fd: number; path: string }): void {
  closeSync(lock.fd);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

function verifyRevisions(guards: EditoolFileGuard[]): void {
  const stale = guards.filter((guard) => editoolFileRevision(guard.path) !== guard.expectedRevision);
  if (stale.length) {
    throw new EditoolStaleRevisionError(
      `policy files changed since they were loaded: ${stale.map((entry) => entry.path).join(", ")}`,
    );
  }
}

function prepareActiveTransaction(
  stateDir: string,
  mutations: EditoolFileMutation[],
): { activeDir: string; journalPath: string; journal: TransactionJournal } {
  const activeDir = join(stateDir, ACTIVE_DIR);
  rmSync(activeDir, { recursive: true, force: true });
  mkdirSync(activeDir, { recursive: true });
  const id = randomUUID();
  const records = mutations.map((mutation, index): TransactionRecord => {
    const backupPath = join(activeDir, `${index}.original`);
    const stagedPath = join(activeDir, `${index}.staged`);
    const originalExists = existsSync(mutation.path);
    const originalMode = originalExists ? statSync(mutation.path).mode : null;
    if (originalExists) copyFileSync(mutation.path, backupPath);
    writeFileSync(stagedPath, mutation.content, "utf8");
    return { targetPath: mutation.path, backupPath, stagedPath, originalExists, originalMode };
  });
  const journal: TransactionJournal = { version: 1, id, state: "prepared", records };
  const journalPath = join(activeDir, JOURNAL_FILE);
  writeJsonAtomic(journalPath, journal);
  return { activeDir, journalPath, journal };
}

export function recoverEditoolPolicyTransaction(stateDir: string): "none" | "rolled-back" | "cleaned" {
  const lock = acquireLock(stateDir);
  try {
    return recoverActiveTransaction(stateDir);
  } finally {
    releaseLock(lock);
  }
}

export function runEditoolPolicyTransaction(input: {
  stateDir: string;
  mutations: EditoolFileMutation[];
  guards?: EditoolFileGuard[];
  verifyAfterApply?: () => void;
  failAfterAppliedFiles?: number;
  simulateCrashAfterAppliedFiles?: number;
}): void {
  const duplicateTargets = input.mutations
    .map((mutation) => mutation.path)
    .filter((path, index, values) => values.indexOf(path) !== index);
  if (duplicateTargets.length) throw new Error(`duplicate Editool transaction targets: ${duplicateTargets.join(", ")}`);
  const lock = acquireLock(input.stateDir);
  let prepared: ReturnType<typeof prepareActiveTransaction> | null = null;
  try {
    recoverActiveTransaction(input.stateDir);
    verifyRevisions([
      ...(input.guards ?? []),
      ...input.mutations.map((mutation) => ({
        path: mutation.path,
        expectedRevision: mutation.expectedRevision,
      })),
    ]);
    prepared = prepareActiveTransaction(input.stateDir, input.mutations);
    for (const [index, record] of prepared.journal.records.entries()) {
      mkdirSync(dirname(record.targetPath), { recursive: true });
      renameSync(record.stagedPath, record.targetPath);
      if (record.originalMode !== null) chmodSync(record.targetPath, record.originalMode);
      const applied = index + 1;
      if (input.simulateCrashAfterAppliedFiles === applied) {
        prepared = null;
        throw new Error(`simulated process interruption after ${applied} files`);
      }
      if (input.failAfterAppliedFiles === applied) {
        throw new Error(`injected Editool write failure after ${applied} files`);
      }
    }
    input.verifyAfterApply?.();
    prepared.journal.state = "committed";
    writeJsonAtomic(prepared.journalPath, prepared.journal);
    rmSync(prepared.activeDir, { recursive: true, force: true });
    prepared = null;
  } catch (error) {
    if (prepared) {
      try {
        restoreJournal(prepared.journal);
        rmSync(prepared.activeDir, { recursive: true, force: true });
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], "Editool save failed and rollback was incomplete");
      }
    }
    throw error;
  } finally {
    releaseLock(lock);
  }
}
