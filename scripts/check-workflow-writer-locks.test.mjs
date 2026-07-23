import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowWriterSafety } from "./check-workflow-writer-locks.mjs";

const compliantWriter = `
name: writer
concurrency:
  group: app-data-writers
  cancel-in-progress: false
jobs:
  write:
    steps:
      - name: Sync latest main
        run: |
          git fetch origin main --depth=1
          git reset --hard origin/main
      - name: Commit
        run: git push
`;

test("accepts a serialized writer that syncs main", () => {
  assert.deepEqual(validateWorkflowWriterSafety(compliantWriter, "writer.yml"), []);
});

test("ignores workflows that do not push", () => {
  assert.deepEqual(validateWorkflowWriterSafety("name: read-only\n", "read.yml"), []);
});

test("rejects a writer without the shared lock", () => {
  const source = compliantWriter.replace("group: app-data-writers", "group: writer");
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /app-data-writers/);
});

test("rejects a writer without a sync step", () => {
  const source = compliantWriter.replace(
    /      - name: Sync latest main[\s\S]*?(?=      - name: Commit)/,
    "",
  );
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /Sync latest main/);
});

test("rejects an incomplete sync step", () => {
  const source = compliantWriter.replace("          git reset --hard origin/main\n", "");
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /reset to origin\/main/);
});

test("root data publishers must stage the complete data directory", () => {
  const source = compliantWriter.replace(
    "      - name: Commit",
    "      - name: Publish\n        run: ./scripts/publish-data.sh\n      - name: Commit",
  );
  assert.match(
    validateWorkflowWriterSafety(source, "writer.yml").join("\n"),
    /stage the complete site\/data directory/,
  );
  assert.deepEqual(
    validateWorkflowWriterSafety(
      source.replace("        run: git push", "        run: |\n          git add -A -- site/data\n          git push"),
      "writer.yml",
    ),
    [],
  );
});
