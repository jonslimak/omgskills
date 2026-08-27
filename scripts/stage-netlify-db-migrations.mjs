#!/usr/bin/env node

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const defaultSourceDir = path.join(repoRoot, "netlify", "database", "migrations");
const defaultDestinationDir = path.join(
  repoRoot,
  ".netlify",
  "internal",
  "db",
  "migrations",
);
const migrationNamePattern = /^\d{14}_[a-z0-9_]+$/;

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function stageNetlifyDbMigrations({
  sourceDir = defaultSourceDir,
  destinationDir = defaultDestinationDir,
} = {}) {
  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (entries.length === 0) {
    throw new Error(`No Netlify database migrations found in ${sourceDir}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !migrationNamePattern.test(entry.name)) {
      throw new Error(`Invalid Netlify database migration entry: ${entry.name}`);
    }
    const migrationPath = path.join(sourceDir, entry.name, "migration.sql");
    if (!(await isFile(migrationPath))) {
      throw new Error(`Missing migration.sql for Netlify database migration: ${entry.name}`);
    }
  }

  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });
  for (const entry of entries) {
    const destination = path.join(destinationDir, entry.name);
    await mkdir(destination, { recursive: true });
    await cp(
      path.join(sourceDir, entry.name, "migration.sql"),
      path.join(destination, "migration.sql"),
    );
  }

  return entries.map((entry) => entry.name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  stageNetlifyDbMigrations()
    .then((migrations) => {
      console.log(`Staged ${migrations.length} Netlify database migrations`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
